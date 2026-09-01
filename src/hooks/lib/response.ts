export function json(e: core.RequestEvent, data: unknown, status = 200) {
	return e.json(status, data);
}
