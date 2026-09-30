import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Paid tests against the real Claude API (npm run eval). Kept out of `npm test`.
export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
	// verbose: the default reporter hides console output of passing tests, which carries the cost and verdicts.
	test: { include: ['test/**/*.eval.ts'], testTimeout: 30_000, reporters: ['verbose'] },
});
