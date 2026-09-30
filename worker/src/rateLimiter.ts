import { DurableObject } from 'cloudflare:workers';

// Exact per-user rate limit for /parse. Replaces the Workers Rate Limiting binding, which let every
// request through in production (all `success: true` in the logs, one location) while working in local
// dev. One Durable Object per user: its requests run one at a time, so the count is exact.

/** 30 requests per rolling minute per user (CLAUDE.md §6). */
export const LIMIT = 30;
export const WINDOW_MS = 60_000;

/**
 * Sliding window over the request times still inside the window. Returns whether this request is
 * allowed and the times to keep; a refused request isn't recorded, so the window frees up on its own.
 */
export function slidingWindow(
	times: readonly number[],
	now: number,
	limit = LIMIT,
	windowMs = WINDOW_MS,
): { allowed: boolean; times: number[] } {
	const recent = times.filter((t) => t > now - windowMs);
	return recent.length < limit ? { allowed: true, times: [...recent, now] } : { allowed: false, times: recent };
}

export class RateLimiter extends DurableObject<Env> {
	/** Records one request for this user; false when they're over the limit. One storage write when allowed. */
	async hit(): Promise<boolean> {
		const stored = this.ctx.storage.kv.get<number[]>('times') ?? [];
		const { allowed, times } = slidingWindow(stored, Date.now());
		if (allowed) this.ctx.storage.kv.put('times', times);
		return allowed;
	}
}

/** The route's `withinLimit`: each Supabase user id gets its own RateLimiter. */
export function userRateLimit(env: Env): (userId: string) => Promise<boolean> {
	return (userId) => env.RATE_LIMITER.getByName(userId).hit();
}
