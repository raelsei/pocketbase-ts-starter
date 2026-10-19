// Transpiles TS sources into the plain JS layout PocketBase expects (NO bundling):
//   src/hooks/**/*.ts    -> pb_hooks/**/*.js      (lib files become CJS modules)
//   src/migrations/*.ts  -> pb_migrations/*.js
//
// Why no bundling: PB serializes every handler and runs it in its own isolated
// context; nothing from the outer scope is reachable. Shared code MUST be
// loaded INSIDE the handler via require(`${__hooks}/lib/x.js`).
// https://pocketbase.io/docs/js-overview/#handlers-scope
import { mkdirSync, rmSync, watch as watchDirectory } from "node:fs";
import { type BuildOptions, build } from "esbuild";

const watch = process.argv.includes("--watch");

function entries(dir: string): string[] {
	return [...new Bun.Glob("**/*.ts").scanSync(dir)]
		.filter((f) => !f.endsWith(".d.ts"))
		.map((f) => `${dir}/${f}`);
}

const common: BuildOptions = {
	bundle: false,
	format: "cjs", // goja's require() expects CJS; files without exports stay plain scripts
	platform: "neutral",
	target: "es2017",
	legalComments: "none",
	logLevel: "info",
};

const jobs = [
	{ ...common, outdir: "pb_hooks", outbase: "src/hooks" },
	{
		...common,
		outdir: "pb_migrations",
		outbase: "src/migrations",
	},
] satisfies BuildOptions[];

for (const dir of ["pb_hooks", "pb_migrations"]) {
	mkdirSync(dir, { recursive: true });
}

async function rebuild() {
	const results = await Promise.allSettled(
		jobs.map(async (job) => {
			const entryPoints = entries(job.outbase);
			const result = entryPoints.length
				? await build({ ...job, entryPoints, metafile: true })
				: undefined;
			const outputs = new Set(Object.keys(result?.metafile?.outputs ?? {}));
			// A removed/renamed source must not leave a live route or migration behind.
			// Only clean after a successful build, preserving the last working output on errors.
			for (const file of new Bun.Glob("**/*.js").scanSync(job.outdir)) {
				const output = `${job.outdir}/${file}`;
				if (!outputs.has(output)) rmSync(output);
			}
		}),
	);
	for (const result of results) {
		if (result.status === "rejected") throw result.reason;
	}
}

if (watch) {
	// esbuild's fixed entryPoints list cannot discover added files. Watch source
	// directories instead, re-scan entries and serialize builds after each change.
	let pending = Promise.resolve();
	let timer: ReturnType<typeof setTimeout>;
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			pending = pending.then(rebuild).catch(() => {
				console.error("Build failed; watching for the next change.");
			});
		}, 100);
	};
	for (const dir of ["src/hooks", "src/migrations"]) {
		watchDirectory(dir, { recursive: true }, schedule);
	}
	schedule();
	console.log("watching src/ ...");
} else {
	await rebuild();
}
