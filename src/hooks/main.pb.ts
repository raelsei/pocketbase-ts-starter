// Example hook. Types for the global APIs (routerAdd, onBootstrap, $app, ...)
// come from types/pocketbase-jsvm.d.ts.
//
// NOTE: PB runs every handler in an isolated context; variables/functions
// from the outer scope are NOT reachable inside a handler. Shared code is
// loaded with require inside the handler; `import type` is type-only and
// fully erased at build time:
// https://pocketbase.io/docs/js-overview/#handlers-scope
import type * as response from "./lib/response";

routerAdd("GET", "/api/ping", (e) => {
	const { json } = require(`${__hooks}/lib/response.js`) as typeof response;

	return json(e, { message: "pong", time: new Date().toISOString() });
});

onBootstrap((e) => {
	e.next();

	console.log("pb_hooks loaded");
});
