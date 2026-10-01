import { UNCLEAR, type ParseRequest } from '../../shared/contract';
import { AiUnavailableError, workerAi } from './ai';

const REQ: ParseRequest = { text: 'press 24 4 de 9', image: null, context: { muscle_groups: ['shoulders'], exercises: [] } };
const LOG = { intent: 'log', entries: [], ambiguity: null, reply: null };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('workerAi', () => {
  it('POSTs to /parse with the bearer token and the request as JSON', async () => {
    const { fetcher, calls } = fakeFetch(() => Response.json(LOG));
    await expect(workerAi('https://api.test', async () => 'tok', fetcher).parse(REQ)).resolves.toEqual(LOG);
    expect(calls[0].url).toBe('https://api.test/parse');
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(REQ);
  });

  it('an answer that does not match the contract is unclear', async () => {
    const { fetcher } = fakeFetch(() => Response.json({ intent: 'dance' }));
    await expect(workerAi('https://api.test', async () => 'tok', fetcher).parse(REQ)).resolves.toEqual(UNCLEAR);
  });

  const cases: [string, () => Promise<string | null>, () => Response | Promise<Response>][] = [
    ['no session', async () => null, () => Response.json(LOG)],
    ['no signal', async () => 'tok', () => Promise.reject(new TypeError('Network request failed'))],
    ['rate limited', async () => 'tok', () => new Response('', { status: 429 })],
    ['Worker error', async () => 'tok', () => new Response('', { status: 502 })],
  ];
  it.each(cases)('%s → AiUnavailableError (the entry stays pending)', async (_l, token, respond) => {
    const { fetcher } = fakeFetch(respond);
    await expect(workerAi('https://api.test', token, fetcher).parse(REQ)).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
