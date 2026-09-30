import { describe, expect, it } from 'vitest';

import { deleteSupabaseUser } from '../src/account';

function fakeFetch(status: number) {
	const seen: { url: string; method: string; apikey: string | null; auth: string | null }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		const h = new Headers(init.headers);
		seen.push({ url, method: init.method!, apikey: h.get('apikey'), auth: h.get('Authorization') });
		return new Response(status === 200 ? '{}' : 'nope', { status });
	}) as unknown as typeof fetch;
	return { fetcher, seen };
}

describe('deleteSupabaseUser', () => {
	it('calls the Auth admin API with the secret key on the apikey header', async () => {
		const { fetcher, seen } = fakeFetch(200);
		await deleteSupabaseUser('user-1', 'https://abc.supabase.co', 'sb_secret_x', fetcher);
		expect(seen).toEqual([
			{ url: 'https://abc.supabase.co/auth/v1/admin/users/user-1', method: 'DELETE', apikey: 'sb_secret_x', auth: null },
		]);
	});

	it('an already deleted user counts as deleted (retries finish)', async () => {
		await expect(deleteSupabaseUser('u', 'https://abc.supabase.co', 'k', fakeFetch(404).fetcher)).resolves.toBeUndefined();
	});

	it('other errors throw', async () => {
		await expect(deleteSupabaseUser('u', 'https://abc.supabase.co', 'k', fakeFetch(500).fetcher)).rejects.toThrow(/500/);
	});
});
