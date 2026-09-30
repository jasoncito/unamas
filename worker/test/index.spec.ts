import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The real wiring (index.ts) inside workerd, with the bindings from wrangler.jsonc.
describe('deployed shape', () => {
	it('unknown paths are 404', async () => {
		const res = await exports.default.fetch('https://api.test/');
		expect(res.status).toBe(404);
	});

	it('/parse without a token is 401 (before any network call)', async () => {
		const res = await exports.default.fetch('https://api.test/parse', { method: 'POST', body: '{}' });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'unauthorized' });
	});

	it('/account/delete with a forged token is 401', async () => {
		const res = await exports.default.fetch('https://api.test/account/delete', {
			method: 'POST',
			headers: { Authorization: 'Bearer not.a.jwt' },
		});
		expect(res.status).toBe(401);
	});
});
