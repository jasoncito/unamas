import { ParseRequest, type ParseResponse } from '../../shared/contract';

/** What the routes need from the outside world; index.ts wires the real ones, tests pass fakes. */
export interface AppDeps {
	/** Supabase user id of the request, or null. */
	verify(request: Request): Promise<string | null>;
	/** False when this user is over the rate limit. */
	withinLimit(userId: string): Promise<boolean>;
	parse(request: ParseRequest): Promise<ParseResponse>;
	deleteUser(userId: string): Promise<void>;
}

/** POST /parse and POST /account/delete; everything else is 404. */
export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
	return async (request) => {
		const { pathname } = new URL(request.url);
		const route = ROUTES[pathname];
		if (!route) return json({ error: 'not_found' }, 404);
		if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

		const userId = await deps.verify(request);
		if (!userId) return json({ error: 'unauthorized' }, 401);
		return route(request, userId, deps);
	};
}

type Route = (request: Request, userId: string, deps: AppDeps) => Promise<Response>;

const ROUTES: Record<string, Route> = {
	'/parse': async (request, userId, deps) => {
		if (!(await deps.withinLimit(userId))) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });

		const body = await request.json().catch(() => null);
		const parsed = ParseRequest.safeParse(body);
		if (!parsed.success) return json({ error: 'invalid_request', issues: parsed.error.issues.slice(0, 5) }, 400);

		try {
			return json(await deps.parse(parsed.data), 200);
		} catch (e) {
			console.error('parse failed', e);
			return json({ error: 'upstream_error' }, 502);
		}
	},

	'/account/delete': async (_request, userId, deps) => {
		try {
			await deps.deleteUser(userId);
			return json({ deleted: true }, 200);
		} catch (e) {
			console.error('account delete failed', e);
			return json({ error: 'upstream_error' }, 502);
		}
	},
};

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers });
}
