// PB jsvm'in sağladığı ama üretilen types.d.ts'te bildirilmeyen globaller.
// (tsconfig lib'i ES2017 — DOM yok; console'u goja sağlar.)
declare function require(module: string): unknown;

declare const console: {
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	info(...args: unknown[]): void;
	debug(...args: unknown[]): void;
};
