import { describe, expect, it, vi } from 'vitest';

import { UNCLEAR, type ParseRequest } from '../../shared/contract';
import { createApp, type AppDeps } from '../src/app';

const REQ: ParseRequest = { text: 'press de hombro 24 4 de 9', image: null, context: { muscle_groups: ['hombro'], exercises: [] } };

function app(over: Partial<AppDeps> = {}) {
	const calls: string[] = [];
	const deps: AppDeps = {
		verify: async (r) => (r.headers.get('Authorization') === 'Bearer good' ? 'user-1' : null),
		withinLimit: async () => true,
		parse: async () => {
			calls.push('parse');
			return UNCLEAR;
		},
		deleteUser: async (id) => void calls.push(`delete:${id}`),
		...over,
	};
	return { handle: createApp(deps), calls };
}

const post = (path: string, body: unknown = REQ, auth = 'Bearer good') =>
	new Request(`https://api.test${path}`, {
		method: 'POST',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

describe('routes', () => {
	it('unknown paths are 404', async () => {
		expect((await app().handle(post('/nope'))).status).toBe(404);
	});

	it('GET on a known path is 405', async () => {
		const res = await app().handle(new Request('https://api.test/parse'));
		expect(res.status).toBe(405);
		expect(res.headers.get('Allow')).toBe('POST');
	});
});

describe('auth', () => {
	it.each(['/parse', '/account/delete'])('%s without a valid token is 401 and does nothing', async (path) => {
		const { handle, calls } = app();
		expect((await handle(post(path, REQ, 'Bearer bad'))).status).toBe(401);
		expect((await handle(post(path, REQ, ''))).status).toBe(401);
		expect(calls).toEqual([]);
	});
});

describe('POST /parse', () => {
	it('returns what the parser returns', async () => {
		const res = await app().handle(post('/parse'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(UNCLEAR);
	});

	it('the rate limit is per user and answers 429 before calling Claude', async () => {
		const keys: string[] = [];
		const { handle, calls } = app({
			withinLimit: async (id) => {
				keys.push(id);
				return false;
			},
		});
		const res = await handle(post('/parse'));
		expect(res.status).toBe(429);
		expect(res.headers.get('Retry-After')).toBe('60');
		expect(keys).toEqual(['user-1']);
		expect(calls).toEqual([]);
	});

	it('an invalid body still uses up quota: the limit is checked before reading the body', async () => {
		let used = 0;
		const { handle } = app({ withinLimit: async () => ++used <= 2 });
		expect((await handle(post('/parse', 'garbage'))).status).toBe(400);
		expect((await handle(post('/parse', 'garbage'))).status).toBe(400);
		expect((await handle(post('/parse', 'garbage'))).status).toBe(429);
		expect(used).toBe(3);
	});

	it('logs whether each request was within the limit, without the user id', async () => {
		const logs: string[] = [];
		const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
		let n = 0;
		const { handle } = app({ withinLimit: async () => ++n === 1 });
		await handle(post('/parse'));
		await handle(post('/parse'));
		spy.mockRestore();
		expect(logs.map((l) => JSON.parse(l))).toEqual([
			{ event: 'rate_limit', success: true },
			{ event: 'rate_limit', success: false },
		]);
		expect(logs.join()).not.toContain('user-1');
	});

	it.each([
		['not JSON', 'press 24'],
		['missing context', { text: 'x', image: null }],
		['text too long', { ...REQ, text: 'x'.repeat(1001) }],
		['image not base64', { ...REQ, image: 'not base64!' }],
		['too many exercises', { ...REQ, context: { muscle_groups: [], exercises: Array(301).fill({ id: 'a', name: 'a', aliases: [], muscle_groups: [], last: null }) } }],
	])('%s is 400 and never reaches Claude', async (_label, body) => {
		const { handle, calls } = app();
		const res = await handle(post('/parse', body));
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	it('a Claude failure is 502 (the app keeps the entry pending and retries)', async () => {
		const res = await app({ parse: async () => Promise.reject(new Error('overloaded')) }).handle(post('/parse'));
		expect(res.status).toBe(502);
	});
});

describe('POST /account/delete', () => {
	it("deletes the token's user, never another one", async () => {
		const { handle, calls } = app();
		const res = await handle(post('/account/delete', { user_id: 'someone-else' }));
		expect(res.status).toBe(200);
		expect(calls).toEqual(['delete:user-1']);
	});

	it('a Supabase failure is 502', async () => {
		const res = await app({ deleteUser: async () => Promise.reject(new Error('500')) }).handle(post('/account/delete'));
		expect(res.status).toBe(502);
	});
});
