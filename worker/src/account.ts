/**
 * Deletes a Supabase user with the project's secret key; their rows go with it (on delete cascade).
 * Idempotent: a user that no longer exists counts as deleted, so a retried plan-B switch can finish.
 */
export async function deleteSupabaseUser(
	userId: string,
	supabaseUrl: string,
	secretKey: string,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const res = await fetcher(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
		method: 'DELETE',
		// New secret keys (sb_secret_…) go on the apikey header, not Authorization (Supabase docs, API keys).
		headers: { apikey: secretKey },
	});
	if (res.ok || res.status === 404) return;
	throw new Error(`Supabase admin delete failed: ${res.status} ${await res.text()}`);
}
