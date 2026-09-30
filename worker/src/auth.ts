import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Supabase access tokens are JWTs signed with the project's asymmetric key (ES256). The public keys are
// published at /auth/v1/.well-known/jwks.json, so the Worker verifies them without any secret.

const jwksByProject = new Map<string, JWTVerifyGetKey>();

/** The project's public keys, fetched once per Worker instance and refreshed by jose when they rotate. */
export function supabaseKeys(supabaseUrl: string): JWTVerifyGetKey {
	let keys = jwksByProject.get(supabaseUrl);
	if (!keys) {
		keys = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
		jwksByProject.set(supabaseUrl, keys);
	}
	return keys;
}

/**
 * The Supabase user id (`sub`) of a request's `Authorization: Bearer <access token>`, or null when it's
 * missing, badly signed, expired, or issued by another project.
 */
export async function verifyUser(request: Request, keys: JWTVerifyGetKey, supabaseUrl: string): Promise<string | null> {
	const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
	if (!match) return null;
	try {
		const { payload } = await jwtVerify(match[1], keys, {
			issuer: `${supabaseUrl}/auth/v1`,
			audience: 'authenticated',
		});
		return typeof payload.sub === 'string' ? payload.sub : null;
	} catch {
		return null;
	}
}
