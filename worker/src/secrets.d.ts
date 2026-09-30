// Secrets (see wrangler.jsonc). `wrangler types` only sees them once .dev.vars exists, so they're
// declared here on both Env types it generates (global Env for the Worker, Cloudflare.Env for tests).
interface Secrets {
	ANTHROPIC_API_KEY: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
}
interface Env extends Secrets {}
declare namespace Cloudflare {
	interface Env extends Secrets {}
}
