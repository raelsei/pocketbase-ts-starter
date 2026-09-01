// Production hardening (https://pocketbase.io/docs/going-to-production/):
// - Builtin rate limiter (dashboard'un önerdiği varsayılan kurallar)
// - Reverse proxy arkasında gerçek client IP'si için trusted proxy header
//   (superuser IP allowlist ve rate limiter doğru IP'yi bunun üstünden görür)
migrate(
	(app) => {
		const settings = app.settings();

		settings.rateLimits.enabled = true;
		settings.rateLimits.rules = [
			{ label: "*:auth", audience: "", duration: 3, maxRequests: 2 },
			{ label: "*:create", audience: "", duration: 5, maxRequests: 20 },
			{ label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
			{ label: "/api/", audience: "", duration: 10, maxRequests: 300 },
		] as core.RateLimitRule[];

		settings.trustedProxy.headers = ["X-Forwarded-For"];
		settings.trustedProxy.useLeftmostIP = false;

		app.save(settings);
	},
	(app) => {
		const settings = app.settings();

		settings.rateLimits.enabled = false;
		settings.trustedProxy.headers = [];

		app.save(settings);
	},
);
