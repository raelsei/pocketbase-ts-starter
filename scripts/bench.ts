// Isolated PocketBase benchmark. Builds the production image, runs it with the
// same lockdown as compose.prod.yml under a small-VPS CPU/RAM budget, and fires
// oha (https://github.com/hatoo/oha) at it from a sibling container on a private
// network — the host network stack never sees the requests.
//
//   bun run bench                        # 2 vCPU / 2 GB, 64 connections, 15 s per scenario
//   bun run bench --cpus 4 --memory 4g --concurrency 128 --duration 30s
//
// Writes docs/benchmark.json and docs/benchmark-{light,dark}.svg, prints a
// markdown table. Everything it creates (container, network, volume, image) is
// removed afterwards, also on failure.
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: {
		cpus: { type: "string", default: "2" },
		memory: { type: "string", default: "2g" },
		concurrency: { type: "string", default: "64" },
		duration: { type: "string", default: "15s" },
		// re-render the SVGs from docs/benchmark.json without running anything
		render: { type: "boolean", default: false },
	},
});

const PB_VERSION = "0.40.1";
const IMAGE = "pocketbase-ts-starter:bench";
const NET = "pbbench-net";
const VOL = "pbbench-data";
const PB = "pbbench-pb";
const HOST_PORT = 18095;
const HOST = `http://127.0.0.1:${HOST_PORT}`;
const INTERNAL = `http://${PB}:8080`;
const ADMIN = { email: "bench@example.com", password: "bench-password-1234" };
const USER = { email: "user@example.com", password: "user-password-1234" };
const $ = Bun.$;

type Scenario = {
	id: string;
	label: string;
	group: "read" | "write" | "auth" | "baseline";
	args: string[];
	concurrency?: number;
};

type Result = Scenario & {
	rps: number;
	p50: number;
	p95: number;
	p99: number;
	successRate: number;
	requests: number;
	statusCodes: Record<string, number>;
};

// GOMEMLIMIT ≈ 85% of the container limit, mirroring compose.prod.yml.
function goMemLimit(memory: string): string {
	const m = /^(\d+)([gGmM])$/.exec(memory);
	if (!m) throw new Error(`--memory must look like 2g or 512m, got ${memory}`);
	const mib = Number(m[1]) * (m[2]?.toLowerCase() === "g" ? 1024 : 1);
	return `${Math.floor(mib * 0.85)}MiB`;
}

async function cleanup() {
	await $`docker rm -f ${PB}`.quiet().nothrow();
	await $`docker volume rm -f ${VOL}`.quiet().nothrow();
	await $`docker network rm ${NET}`.quiet().nothrow();
	await $`docker rmi -f ${IMAGE}`.quiet().nothrow();
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
	const res = await fetch(`${HOST}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			...(token ? { authorization: token } : {}),
			...(init.headers ?? {}),
		},
	});
	if (!res.ok)
		throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
	return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function waitHealthy() {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`${HOST}/api/health`);
			if (res.ok) return;
		} catch {}
		await Bun.sleep(500);
	}
	throw new Error("PocketBase did not become healthy in 30 s");
}

async function oha(s: Scenario): Promise<Result> {
	const c = String(s.concurrency ?? opt.concurrency);
	const out =
		await $`docker run --rm --network ${NET} ghcr.io/hatoo/oha:latest --no-tui --output-format json -w -z ${opt.duration} -c ${c} ${s.args}`.text();
	const j = JSON.parse(out);
	const statusCodes: Record<string, number> = j.statusCodeDistribution;
	// oha counts any HTTP response as a "success", including 4xx/5xx. A benchmark
	// of error pages is worthless, so refuse anything but 2xx.
	const bad = Object.keys(statusCodes).filter((code) => !code.startsWith("2"));
	if (bad.length > 0 || Object.keys(j.errorDistribution ?? {}).length > 0) {
		throw new Error(
			`${s.id}: non-2xx responses ${JSON.stringify(statusCodes)} errors ${JSON.stringify(j.errorDistribution)}`,
		);
	}
	const toMs = (sec: number) => Math.round(sec * 1000 * 100) / 100;
	return {
		...s,
		concurrency: Number(c),
		rps: Math.round(j.summary.requestsPerSec),
		p50: toMs(j.latencyPercentiles.p50),
		p95: toMs(j.latencyPercentiles.p95),
		p99: toMs(j.latencyPercentiles.p99),
		successRate: j.summary.successRate,
		requests: Object.values(statusCodes).reduce((a, b) => a + b, 0),
		statusCodes,
	};
}

const fmt = (n: number) => n.toLocaleString("en-US");

function svg(results: Result[], meta: Record<string, string>, dark: boolean): string {
	const bg = dark ? "#16161a" : "#ffffff";
	const fg = dark ? "#e6e6e6" : "#1f2328";
	const muted = dark ? "#8b8b93" : "#656d76";
	const track = dark ? "#26262c" : "#eef1f4";
	const color: Record<Scenario["group"], string> = {
		baseline: dark ? "#6b7280" : "#9ca3af",
		read: "#3178c6",
		write: "#e8a33d",
		auth: "#e05d5d",
	};
	const W = 980;
	const left = 250;
	const barW = W - left - 330;
	const rowH = 40;
	const top = 78;
	const H = top + results.length * rowH + 56;
	// log scale: 10 req/s .. 100k req/s keeps 30 rps auth and 10k rps health on one chart
	const lo = Math.log10(10);
	const hi = Math.log10(100_000);
	const x = (rps: number) => (Math.max(0, Math.log10(Math.max(rps, 10)) - lo) / (hi - lo)) * barW;
	const ticks = [10, 100, 1_000, 10_000, 100_000];

	const rows = results
		.map((r, i) => {
			const y = top + i * rowH;
			const w = Math.max(3, x(r.rps));
			return `
  <text x="${left - 14}" y="${y + 19}" text-anchor="end" fill="${fg}" font-size="14" font-weight="600">${r.label}</text>
  <rect x="${left}" y="${y + 6}" width="${barW}" height="20" rx="4" fill="${track}"/>
  <rect x="${left}" y="${y + 6}" width="${w.toFixed(1)}" height="20" rx="4" fill="${color[r.group]}"/>
  <text x="${left + barW + 14}" y="${y + 21}" fill="${fg}" font-size="14" font-variant-numeric="tabular-nums"><tspan font-weight="700">${fmt(r.rps)}</tspan> req/s<tspan fill="${muted}"> · p50 ${r.p50.toFixed(1)} ms · p99 ${r.p99.toFixed(0)} ms</tspan></text>`;
		})
		.join("");

	const grid = ticks
		.map((t) => {
			const gx = left + x(t);
			return `
  <line x1="${gx.toFixed(1)}" y1="${top - 6}" x2="${gx.toFixed(1)}" y2="${top + results.length * rowH}" stroke="${track}" stroke-width="1"/>
  <text x="${gx.toFixed(1)}" y="${top + results.length * rowH + 18}" text-anchor="middle" fill="${muted}" font-size="11">${t >= 1000 ? `${t / 1000}k` : t}</text>`;
		})
		.join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <rect width="${W}" height="${H}" rx="12" fill="${bg}"/>
  <text x="28" y="34" fill="${fg}" font-size="18" font-weight="700">PocketBase ${meta.pbVersion} · ${meta.cpus} vCPU / ${meta.memory.replace(/g$/i, " GB").replace(/m$/i, " MB")} RAM</text>
  <text x="28" y="56" fill="${muted}" font-size="13">${meta.concurrency} concurrent connections · ${meta.duration} per scenario · keep-alive · ${meta.records} records in the collection · log scale</text>${grid}${rows}
  <text x="28" y="${H - 14}" fill="${muted}" font-size="11">${meta.host} · ${meta.date} · bun run bench</text>
</svg>
`;
}

process.on("SIGINT", async () => {
	await cleanup();
	process.exit(130);
});

if (opt.render) {
	const saved = JSON.parse(await Bun.file("docs/benchmark.json").text());
	await Bun.write("docs/benchmark-light.svg", svg(saved.results, saved.meta, false));
	await Bun.write("docs/benchmark-dark.svg", svg(saved.results, saved.meta, true));
	process.exit(0);
}

try {
	await cleanup();
	console.log(`building ${IMAGE} ...`);
	await $`docker build -q --build-arg PB_VERSION=${PB_VERSION} -t ${IMAGE} .`.quiet();
	await $`docker network create ${NET}`.quiet();
	await $`docker pull -q ghcr.io/hatoo/oha:latest`.quiet();

	console.log(`starting PocketBase: ${opt.cpus} vCPU / ${opt.memory} ...`);
	const runFlags = [
		...["--cpus", opt.cpus, "--memory", opt.memory],
		...[
			"-e",
			`GOMAXPROCS=${Math.ceil(Number(opt.cpus))}`,
			"-e",
			`GOMEMLIMIT=${goMemLimit(opt.memory)}`,
		],
		...[
			"--read-only",
			"--tmpfs",
			"/tmp",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges:true",
		],
		...["-v", `${VOL}:/pb/pb_data`, "-p", `127.0.0.1:${HOST_PORT}:8080`],
		...["-e", `PB_ADMIN_EMAIL=${ADMIN.email}`, "-e", `PB_ADMIN_PASSWORD=${ADMIN.password}`],
		...["-e", "PB_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef"],
	];
	await $`docker run -d --name ${PB} --network ${NET} ${runFlags} ${IMAGE}`.quiet();
	await waitHealthy();

	const { token } = await api<{ token: string }>(
		"/api/collections/_superusers/auth-with-password",
		{
			method: "POST",
			body: JSON.stringify({ identity: ADMIN.email, password: ADMIN.password }),
		},
	);

	// The rate limiter (300 req / 10 s per IP) would cap every scenario at 30 req/s.
	await api(
		"/api/settings",
		{ method: "PATCH", body: JSON.stringify({ rateLimits: { enabled: false } }) },
		token,
	);

	// Public rules on purpose: measure PocketBase, not the bcrypt cost of every request.
	await api(
		"/api/collections",
		{
			method: "POST",
			body: JSON.stringify({
				name: "bench",
				type: "base",
				listRule: "",
				viewRule: "",
				createRule: "",
				fields: [
					{ type: "text", name: "title", required: true, max: 200 },
					{ type: "text", name: "body", max: 2000 },
					{ type: "bool", name: "published" },
					{ type: "autodate", name: "created", onCreate: true },
				],
				indexes: ["CREATE INDEX idx_bench_created ON bench (created)"],
			}),
		},
		token,
	);
	await api(
		"/api/collections/users/records",
		{
			method: "POST",
			body: JSON.stringify({
				email: USER.email,
				password: USER.password,
				passwordConfirm: USER.password,
			}),
		},
		token,
	);

	const body = JSON.stringify({
		title: "Benchmark post",
		body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4).trim(),
		published: true,
	});
	const results: Result[] = [];
	const run = async (s: Scenario) => {
		process.stdout.write(`  ${s.label.padEnd(36)}`);
		const r = await oha(s);
		results.push(r);
		console.log(
			`${fmt(r.rps).padStart(7)} req/s   p50 ${r.p50} ms   p99 ${r.p99} ms   ok ${(r.successRate * 100).toFixed(1)}%`,
		);
	};

	console.log("running scenarios ...");
	// Writes go first: they seed the collection the read scenarios page through.
	await run({
		id: "create-c1",
		label: "Create record (1 connection)",
		group: "write",
		concurrency: 1,
		args: [
			"-m",
			"POST",
			"-T",
			"application/json",
			"-d",
			body,
			`${INTERNAL}/api/collections/bench/records`,
		],
	});
	await run({
		id: "create",
		label: `Create record (${opt.concurrency} connections)`,
		group: "write",
		args: [
			"-m",
			"POST",
			"-T",
			"application/json",
			"-d",
			body,
			`${INTERNAL}/api/collections/bench/records`,
		],
	});

	const page = await api<{ totalItems: number; items: { id: string }[] }>(
		"/api/collections/bench/records?perPage=1&sort=-created",
	);
	const records = page.totalItems;
	const someId = page.items[0]?.id;
	if (!someId) throw new Error("no records were created; check the write scenario output");

	// PocketBase runs COUNT(DISTINCT id) for totalItems on every list call unless
	// skipTotal=1 is passed. On a big collection that count IS the cost.
	await run({
		id: "list-total",
		label: "List 30 (with totalItems)",
		group: "read",
		args: [`${INTERNAL}/api/collections/bench/records?perPage=30&sort=-created`],
	});
	await run({
		id: "list-skip-total",
		label: "List 30 (skipTotal=1)",
		group: "read",
		args: [`${INTERNAL}/api/collections/bench/records?perPage=30&sort=-created&skipTotal=1`],
	});
	await run({
		id: "view",
		label: "Get one record by id",
		group: "read",
		args: [`${INTERNAL}/api/collections/bench/records/${someId}`],
	});
	await run({
		id: "auth",
		label: "Auth with password (bcrypt)",
		group: "auth",
		args: [
			"-m",
			"POST",
			"-T",
			"application/json",
			"-d",
			JSON.stringify({ identity: USER.email, password: USER.password }),
			`${INTERNAL}/api/collections/users/auth-with-password`,
		],
	});
	await run({
		id: "hook",
		label: "JS hook route (/api/ping)",
		group: "baseline",
		args: [`${INTERNAL}/api/ping`],
	});
	await run({
		id: "health",
		label: "Go baseline (/api/health)",
		group: "baseline",
		args: [`${INTERNAL}/api/health`],
	});

	const mem =
		(await $`docker stats --no-stream --format {{.MemUsage}} ${PB}`.text())
			.trim()
			.split(" / ")[0] ?? "";
	const uname = (await $`uname -sm`.text()).trim();
	const docker = (await $`docker info --format {{.OperatingSystem}}`.text()).trim();
	const meta = {
		pbVersion: PB_VERSION,
		cpus: opt.cpus ?? "",
		memory: opt.memory ?? "",
		concurrency: opt.concurrency ?? "",
		duration: opt.duration ?? "",
		records: fmt(records),
		memoryUsed: mem,
		host: `${uname} · ${docker}`,
		date: new Date().toISOString().slice(0, 10),
	};

	await Bun.write("docs/benchmark.json", `${JSON.stringify({ meta, results }, null, "\t")}\n`);
	await Bun.write("docs/benchmark-light.svg", svg(results, meta, false));
	await Bun.write("docs/benchmark-dark.svg", svg(results, meta, true));

	console.log(`\nPocketBase RSS after the run: ${mem} · ${fmt(records)} records\n`);
	console.log("| Scenario | req/s | p50 | p95 | p99 | 2xx |");
	console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
	for (const r of results) {
		console.log(
			`| ${r.label} | ${fmt(r.rps)} | ${r.p50} ms | ${r.p95} ms | ${r.p99} ms | ${(r.successRate * 100).toFixed(1)}% |`,
		);
	}
} finally {
	await cleanup();
}
