import { ensureSession, type AuthClient } from './auth';

function fakeAuth(opts: { session?: string; offline?: boolean; errors?: boolean } = {}) {
  let signIns = 0;
  let offline = opts.offline ?? false;
  let session = opts.session ?? null;
  const auth: AuthClient = {
    async getSession() {
      if (offline) throw new Error('Network request failed');
      return { data: { session: session ? { user: { id: session } } : null }, error: null };
    },
    async signInAnonymously() {
      signIns++;
      await new Promise((r) => setTimeout(r, 5));
      if (opts.errors) return { data: { user: null }, error: new Error('rate limited') };
      session = `anon-${signIns}`;
      return { data: { user: { id: session } }, error: null };
    },
  };
  return { auth, signIns: () => signIns, goOnline: () => (offline = false) };
}

describe('ensureSession', () => {
  it('reuses the stored session without signing in again', async () => {
    const { auth, signIns } = fakeAuth({ session: 'user-1' });
    await expect(ensureSession(auth)).resolves.toBe('user-1');
    expect(signIns()).toBe(0);
  });

  it('creates an anonymous account on first launch', async () => {
    const { auth, signIns } = fakeAuth();
    await expect(ensureSession(auth)).resolves.toBe('anon-1');
    expect(signIns()).toBe(1);
  });

  it('without signal returns null instead of throwing', async () => {
    const { auth } = fakeAuth({ offline: true });
    await expect(ensureSession(auth)).resolves.toBeNull();
  });

  it('a sign-in error (e.g. rate limit) returns null', async () => {
    const { auth } = fakeAuth({ errors: true });
    await expect(ensureSession(auth)).resolves.toBeNull();
  });

  it('launch and foreground at once create a single anonymous user', async () => {
    const { auth, signIns } = fakeAuth();
    const [a, b] = await Promise.all([ensureSession(auth), ensureSession(auth)]);
    expect([a, b]).toEqual(['anon-1', 'anon-1']);
    expect(signIns()).toBe(1);
  });

  it('first launch without signal: a later call (foreground, signal back) creates the account', async () => {
    const { auth, goOnline } = fakeAuth({ offline: true });
    await expect(ensureSession(auth)).resolves.toBeNull();
    goOnline();
    await expect(ensureSession(auth)).resolves.toBe('anon-1');
  });
});
