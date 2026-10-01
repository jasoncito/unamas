import { ParseResponse, UNCLEAR, type ParseRequest } from '../../shared/contract';

/** /parse as the session controller sees it; tests pass a fake. */
export interface AiService {
  parse(request: ParseRequest): Promise<ParseResponse>;
}

/** No signal, no session, or the Worker failed: the entry stays pending (CLAUDE.md §4.4, step 5). */
export class AiUnavailableError extends Error {}

const TIMEOUT_MS = 20_000;

/**
 * The Worker's POST /parse with the Supabase access token. The response is checked against the shared
 * contract: anything that doesn't match is `unclear` (CLAUDE.md §6).
 */
export function workerAi(baseUrl: string, getAccessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch): AiService {
  return {
    async parse(request) {
      const token = await getAccessToken();
      if (!token) throw new AiUnavailableError('no session');
      let res: Response;
      try {
        res = await fetcher(`${baseUrl}/parse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new AiUnavailableError(String(e));
      }
      if (!res.ok) throw new AiUnavailableError(`HTTP ${res.status}`);
      const parsed = ParseResponse.safeParse(await res.json().catch(() => null));
      return parsed.success ? parsed.data : UNCLEAR;
    },
  };
}
