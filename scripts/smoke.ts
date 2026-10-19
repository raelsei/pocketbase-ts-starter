// Run against a built image; all containers, volumes and ports are isolated.
import assert from "node:assert/strict";

const image = process.argv[2] ?? "pocketbase-ts-starter:test";
const name = `pb-smoke-${crypto.randomUUID()}`;
const volume = `${name}-data`;
const email = "smoke@example.com";
const password = "smoke-password-1234";
const changedPassword = "changed-password-5678";
const encryptionKey = "0123456789abcdef0123456789abcdef";
const containers = new Set<string>();
const $ = Bun.$;
let host = "";

async function request(path: string, init: RequestInit = {}) {
	return fetch(`${host}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
}

async function healthy() {
	for (let attempt = 0; attempt < 60; attempt++) {
		const running = await $`docker inspect --format ${"{{.State.Running}}"} ${name}`.text();
		assert.equal(running.trim(), "true", "PocketBase exited before becoming healthy");
		try {
			if ((await request("/api/health")).ok) return;
		} catch {}
		await Bun.sleep(500);
	}
	throw new Error("PocketBase did not become healthy within 30 seconds");
}

async function login(value: string) {
	const response = await request("/api/collections/_superusers/auth-with-password", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ identity: email, password: value }),
	});
	assert.equal(response.status, 200, "Superuser authentication failed");
	const result = (await response.json()) as { token: string };
	return result.token;
}

async function rejectsStartup(suffix: string, env: string[], message: string) {
	const container = `${name}-${suffix}`;
	containers.add(container);
	await $`docker run -d --name ${container} --read-only --tmpfs /tmp --tmpfs /pb/pb_data:uid=1000,gid=1000 --cap-drop ALL --security-opt no-new-privileges:true ${env} ${image}`.quiet();
	for (let attempt = 0; attempt < 30; attempt++) {
		const state = JSON.parse(
			await $`docker inspect --format ${"{{json .State}}"} ${container}`.text(),
		) as { Running: boolean; ExitCode: number };
		if (!state.Running) {
			assert.notEqual(state.ExitCode, 0, `${suffix}: startup should fail`);
			const logs = await $`docker logs ${container}`.quiet().nothrow();
			assert.ok(`${logs.stdout}${logs.stderr}`.includes(message), `${suffix}: missing diagnostic`);
			return;
		}
		await Bun.sleep(300);
	}
	throw new Error(`${suffix}: server started despite invalid configuration`);
}

try {
	containers.add(name);
	await $`docker run -d --name ${name} --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -v ${`${volume}:/pb/pb_data`} -p 127.0.0.1::8080 -e ${`PB_ADMIN_EMAIL=${email}`} -e ${`PB_ADMIN_PASSWORD=${password}`} -e ${`PB_ENCRYPTION_KEY=${encryptionKey}`} -e PB_SUPERUSER_IPS=127.0.0.1 ${image}`.quiet();
	const port = (await $`docker port ${name} 8080/tcp`.text()).trim();
	host = `http://${port}`;
	await healthy();
	assert.equal((await $`docker exec ${name} id -u`.text()).trim(), "1000");
	const ping = await request("/api/ping");
	assert.equal(ping.status, 200);
	assert.equal(((await ping.json()) as { message: string }).message, "pong");

	// The configured proxy header must select an allowed client, and deny others.
	const tokenResponse = await request("/api/collections/_superusers/auth-with-password", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
		body: JSON.stringify({ identity: email, password }),
	});
	assert.equal(tokenResponse.status, 200);
	const { token } = (await tokenResponse.json()) as { token: string };
	const headers = { authorization: token, "x-forwarded-for": "127.0.0.1" };
	assert.equal((await request("/api/settings", { headers })).status, 200);
	assert.equal(
		(await request("/api/settings", { headers: { ...headers, "x-forwarded-for": "192.0.2.1" } }))
			.status,
		403,
	);
	const settings = await request("/api/settings", { headers });
	assert.equal(
		((await settings.json()) as { rateLimits: { enabled: boolean } }).rateLimits.enabled,
		true,
	);
	const posts = await request("/api/collections/posts/records", {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify({ title: "Smoke test", published: true }),
	});
	assert.equal(posts.status, 200, "The posts migration should create a usable collection");
	assert.equal((await request("/api/collections/posts/records")).status, 403);

	// Refreshing the runtime must not silently leave the vendored API types behind.
	const generatedTypes = await $`docker exec ${name} cat /pb/pb_data/types.d.ts`.text();
	assert.ok(
		generatedTypes === (await Bun.file("types/pocketbase-jsvm.d.ts").text()),
		"Refresh vendored PocketBase types after changing the runtime version",
	);

	// Clear the allowlist for host-side login, then change the password explicitly.
	await $`docker exec ${name} /pb/pocketbase superuser ips --dir=/pb/pb_data --encryptionEnv=PB_ENCRYPTION_KEY`.quiet();
	await $`docker exec ${name} /pb/pocketbase superuser update ${email} ${changedPassword} --dir=/pb/pb_data --encryptionEnv=PB_ENCRYPTION_KEY`.quiet();
	// Recreate with the same volume and the original bootstrap credentials.
	await $`docker rm -f ${name}`.quiet();
	await $`docker run -d --name ${name} --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -v ${`${volume}:/pb/pb_data`} -p 127.0.0.1::8080 -e ${`PB_ADMIN_EMAIL=${email}`} -e ${`PB_ADMIN_PASSWORD=${password}`} -e ${`PB_ENCRYPTION_KEY=${encryptionKey}`} ${image}`.quiet();
	host = `http://${(await $`docker port ${name} 8080/tcp`.text()).trim()}`;
	await healthy();
	const freshToken = await login(changedPassword);
	const records = await request("/api/collections/posts/records", {
		headers: { authorization: freshToken },
	});
	assert.equal(((await records.json()) as { totalItems: number }).totalItems, 1);

	await rejectsStartup(
		"invalid-ips",
		["-e", "PB_SUPERUSER_IPS=not-an-ip"],
		"PB_SUPERUSER_IPS failed",
	);
	await rejectsStartup(
		"invalid-admin",
		["-e", `PB_ADMIN_EMAIL=${email}`, "-e", "PB_ADMIN_PASSWORD=short"],
		"password",
	);
	console.log(
		"Smoke checks passed: hooks, migrations, types, access rules, allowlist, persistent credentials and startup failures.",
	);
} catch (error) {
	for (const container of containers) await $`docker logs ${container}`.nothrow();
	throw error;
} finally {
	for (const container of containers) await $`docker rm -f ${container}`.quiet().nothrow();
	await $`docker volume rm ${volume}`.quiet().nothrow();
}
