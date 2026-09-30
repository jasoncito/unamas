import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { verifyUser } from '../src/auth';

const PROJECT = 'https://abc.supabase.co';
let keys: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
	const pair = await generateKeyPair('ES256');
	privateKey = pair.privateKey;
	otherKey = (await generateKeyPair('ES256')).privateKey;
	keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' }] });
});

/** A token like Supabase issues: ES256, iss = <project>/auth/v1, aud = authenticated. */
function token(over: { iss?: string; aud?: string; exp?: string; key?: CryptoKey; sub?: string } = {}) {
	return new SignJWT({ role: 'authenticated', is_anonymous: true })
		.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
		.setSubject(over.sub ?? 'user-1')
		.setIssuer(over.iss ?? `${PROJECT}/auth/v1`)
		.setAudience(over.aud ?? 'authenticated')
		.setIssuedAt()
		.setExpirationTime(over.exp ?? '1h')
		.sign(over.key ?? privateKey);
}

const req = (auth?: string) => new Request('https://api.test/parse', { headers: auth ? { Authorization: auth } : {} });

describe('verifyUser', () => {
	it('a valid Supabase token gives its user id', async () => {
		expect(await verifyUser(req(`Bearer ${await token()}`), keys, PROJECT)).toBe('user-1');
	});

	it.each([
		['no header', async () => undefined],
		['not a bearer token', async () => `Basic ${await token()}`],
		['garbage', async () => 'Bearer abc.def.ghi'],
		['signed with another key', async () => `Bearer ${await token({ key: otherKey })}`],
		['another project', async () => `Bearer ${await token({ iss: 'https://other.supabase.co/auth/v1' })}`],
		['wrong audience', async () => `Bearer ${await token({ aud: 'anon' })}`],
		['expired', async () => `Bearer ${await token({ exp: '-1m' })}`],
	])('%s → null', async (_label, auth) => {
		expect(await verifyUser(req(await auth()), keys, PROJECT)).toBeNull();
	});
});
