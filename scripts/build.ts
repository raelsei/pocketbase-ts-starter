// Transpiles TS sources into the plain JS layout PocketBase expects (NO bundling):
//   src/hooks/**/*.ts    -> pb_hooks/**/*.js      (lib files become CJS modules)
//   src/migrations/*.ts  -> pb_migrations/*.js
//
// Why no bundling: PB serializes every handler and runs it in its own isolated
// context; nothing from the outer scope is reachable. Shared code MUST be
// loaded INSIDE the handler via require(`${__hooks}/lib/x.js`).
// https://pocketbase.io/docs/js-overview/#handlers-scope
import { mkdirSync, rmSync } from "node:fs";
import { type BuildOptions, build, context } from "esbuild";

const watch = process.argv.includes("--watch");

function entries(dir: string): string[] {
	return [...new Bun.Glob("**/*.ts").scanSync(dir)].map((f) => `${dir}/${f}`);
}

const common: BuildOptions = {
	bundle: false,
	format: "cjs", // goja's require() expects CJS; files without exports stay plain scripts
	platform: "neutral",
	target: "es2017",
	legalComments: "none",
	logLevel: "info",
};

const jobs: BuildOptions[] = [
	{ ...common, entryPoints: entries("src/hooks"), outdir: "pb_hooks", outbase: "src/hooks" },
	{
		...common,
		entryPoints: entries("src/migrations"),
		outdir: "pb_migrations",
		outbase: "src/migrations",
	},
];

for (const dir of ["pb_hooks", "pb_migrations"]) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
}

if (watch) {
	for (const job of jobs) {
		(await context(job)).watch();
	}
	console.log("watching src/ ...");
} else {
	await Promise.all(jobs.map((job) => build(job)));
}
