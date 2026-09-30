import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { LIMIT, WINDOW_MS, slidingWindow, userRateLimit } from '../src/rateLimiter';

it('the limit is 30 requests per minute (CLAUDE.md §6)', () => {
	expect([LIMIT, WINDOW_MS]).toEqual([30, 60_000]);
});

describe('slidingWindow', () => {
	const T = 1_000_000;
	const full = Array.from({ length: LIMIT }, (_, i) => T + i); // 30 requests in the last 30 ms

	it('allows up to the limit and records the request', () => {
		const r = slidingWindow(full.slice(0, LIMIT - 1), T + 100);
		expect(r.allowed).toBe(true);
		expect(r.times).toHaveLength(LIMIT);
	});

	it('refuses the one over the limit and does not record it', () => {
		const r = slidingWindow(full, T + 100);
		expect(r.allowed).toBe(false);
		expect(r.times).toEqual(full);
	});

	it('frees up as old requests leave the window', () => {
		// At T + WINDOW_MS the first request (at T) is exactly a minute old: out of the window.
		expect(slidingWindow(full, T + WINDOW_MS - 1).allowed).toBe(false);
		expect(slidingWindow(full, T + WINDOW_MS).allowed).toBe(true);
	});

	it('drops times older than the window', () => {
		expect(slidingWindow([T - WINDOW_MS, T - 1], T).times).toEqual([T - 1, T]);
	});
});

describe('RateLimiter Durable Object', () => {
	it('allows 30 requests in a minute and refuses the 31st', async () => {
		const stub = env.RATE_LIMITER.getByName('user-a');
		const results: boolean[] = [];
		for (let i = 0; i < LIMIT + 1; i++) results.push(await stub.hit());
		expect(results.filter(Boolean)).toHaveLength(LIMIT);
		expect(results.at(-1)).toBe(false);
	});

	it('each user has their own count', async () => {
		const a = env.RATE_LIMITER.getByName('user-b');
		for (let i = 0; i < LIMIT; i++) await a.hit();
		expect(await a.hit()).toBe(false);
		expect(await env.RATE_LIMITER.getByName('user-c').hit()).toBe(true);
	});

	it('the count survives getting a new stub for the same user', async () => {
		for (let i = 0; i < LIMIT; i++) await env.RATE_LIMITER.getByName('user-d').hit();
		expect(await env.RATE_LIMITER.getByName('user-d').hit()).toBe(false);
	});
});

describe('userRateLimit (what /parse uses)', () => {
	it('keys the limit by user id: one user at the limit does not block another', async () => {
		const withinLimit = userRateLimit(env);
		for (let i = 0; i < LIMIT; i++) await withinLimit('user-e');
		expect(await withinLimit('user-e')).toBe(false);
		expect(await withinLimit('user-f')).toBe(true);
	});
});
