// TS kaynaklarını PocketBase'in beklediği düz JS'e transpile eder (bundle YOK):
//   src/hooks/**/*.ts    -> pb_hooks/**/*.js      (lib dosyaları CJS modül olur)
//   src/migrations/*.ts  -> pb_migrations/*.js
//
// Neden bundle yok: PB her handler'ı kendi izole context'inde serialize edip
// çalıştırır; dış scope'a erişilemez. Paylaşılan kod handler İÇİNDE
// require(`${__hooks}/lib/x.js`) ile yüklenmek zorunda.
// https://pocketbase.io/docs/js-overview/#handlers-scope
import { mkdirSync, rmSync } from "node:fs";
import { type BuildOptions, build, context } from "esbuild";

const watch = process.argv.includes("--watch");

function entries(dir: string): string[] {
	return [...new Bun.Glob("**/*.ts").scanSync(dir)].map((f) => `${dir}/${f}`);
}

const common: BuildOptions = {
	bundle: false,
	format: "cjs", // goja require() CJS bekler; export'suz dosyalarda düz script üretir
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
