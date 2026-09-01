// Globals provided by the PB jsvm but missing from the generated types.d.ts.
// (tsconfig lib is ES2017 — no DOM; console is provided by goja.)
declare function require(module: string): unknown;

declare const console: {
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	info(...args: unknown[]): void;
	debug(...args: unknown[]): void;
};
