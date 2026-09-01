// Örnek hook. Global API'ler (routerAdd, onBootstrap, $app, ...) tipleri
// types/pocketbase-jsvm.d.ts'ten gelir.
//
// DİKKAT: PB her handler'ı izole context'te çalıştırır; dış scope'taki
// değişken/fonksiyonlara handler içinden ERİŞİLEMEZ. Paylaşılan kod
// handler içinde require ile yüklenir; `import type` yalnız tip içindir
// ve derlemede tamamen silinir:
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
