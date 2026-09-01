// Production hardening (https://pocketbase.io/docs/going-to-production/):
// - Builtin rate limiter (the default rules suggested by the dashboard)
// - Trusted proxy header so the real client IP is seen behind a reverse proxy
//   (the superuser IP allowlist and the rate limiter both rely on it)
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
