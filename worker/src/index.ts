import Anthropic from '@anthropic-ai/sdk';

import { deleteSupabaseUser } from './account';
import { createApp } from './app';
import { supabaseKeys, verifyUser } from './auth';
import { parseWithClaude } from './claude';

import { userRateLimit } from './rateLimiter';

export { RateLimiter } from './rateLimiter';

// Wires the routes (app.ts) to the real world: Supabase JWKS, the per-user RateLimiter Durable Object,
// Claude, and the Supabase admin API.
export default {
	async fetch(request, env): Promise<Response> {
		const app = createApp({
			verify: (req) => verifyUser(req, supabaseKeys(env.SUPABASE_URL), env.SUPABASE_URL),
			withinLimit: userRateLimit(env),
			parse: (req) => parseWithClaude(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), req),
			deleteUser: (userId) => deleteSupabaseUser(userId, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
		});
		return app(request);
	},
} satisfies ExportedHandler<Env>;
