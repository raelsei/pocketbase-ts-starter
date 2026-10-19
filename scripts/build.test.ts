import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function eventually(check: () => boolean | Promise<boolean>) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await check()) return;
		await Bun.sleep(50);
	}
	throw new Error("Watch output did not converge within 5 seconds");
}

test("watch discovers new files, removes stale output and recovers from syntax errors", async () => {
	const root = mkdtempSync(join(tmpdir(), "pb-build-"));
	mkdirSync(join(root, "src/hooks"), { recursive: true });
	mkdirSync(join(root, "src/migrations"), { recursive: true });
	await Bun.write(join(root, "src/hooks/main.pb.ts"), 'console.log("first");');
	const child = Bun.spawn([process.execPath, join(import.meta.dir, "build.ts"), "--watch"], {
		cwd: root,
		stdout: "ignore",
		stderr: "ignore",
	});
	const compiled = join(root, "pb_hooks/main.pb.js");
	try {
		await eventually(() => existsSync(compiled));
		await Bun.write(join(root, "src/hooks/main.pb.ts"), 'console.log("updated");');
		await eventually(async () => (await Bun.file(compiled).text()).includes("updated"));
		await Bun.write(join(root, "src/hooks/lib/new.ts"), 'export const value = "new";');
		await Bun.write(join(root, "src/migrations/123_new.ts"), 'console.log("migration");');
		await eventually(() => existsSync(join(root, "pb_hooks/lib/new.js")));
		await eventually(() => existsSync(join(root, "pb_migrations/123_new.js")));
		renameSync(join(root, "src/hooks/lib/new.ts"), join(root, "src/hooks/lib/renamed.ts"));
		await eventually(() => existsSync(join(root, "pb_hooks/lib/renamed.js")));
		await eventually(() => !existsSync(join(root, "pb_hooks/lib/new.js")));
		await Bun.write(join(root, "src/hooks/main.pb.ts"), "const broken = ;");
		await Bun.sleep(400);
		assert.equal(child.exitCode, null, "A syntax error must not stop the watcher");
		assert.ok((await Bun.file(compiled).text()).includes("updated"));
		await Bun.write(join(root, "src/hooks/main.pb.ts"), 'console.log("recovered");');
		await eventually(async () => (await Bun.file(compiled).text()).includes("recovered"));
		rmSync(join(root, "src/migrations/123_new.ts"));
		await eventually(() => !existsSync(join(root, "pb_migrations/123_new.js")));
	} finally {
		child.kill();
		await child.exited;
		rmSync(root, { recursive: true, force: true });
	}
}, 20_000);
