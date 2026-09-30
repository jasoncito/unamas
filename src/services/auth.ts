/** The part of supabase.auth this module needs; tests pass a fake. */
export interface AuthClient {
  getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>;
  signInAnonymously(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
}

const inFlight = new WeakMap<AuthClient, Promise<string | null>>();

/**
 * Makes sure there is a Supabase session, creating an anonymous account the first time
 * (MULTIUSER.md §2). Returns the user id, or null if it couldn't (no signal): logging keeps working
 * offline and this is retried later. Never throws. Concurrent calls share one attempt, so a
 * launch and a foreground at the same time can't create two anonymous users.
 */
export function ensureSession(auth: AuthClient): Promise<string | null> {
  const running = inFlight.get(auth);
  if (running) return running;
  const attempt = signInIfNeeded(auth).finally(() => inFlight.delete(auth));
  inFlight.set(auth, attempt);
  return attempt;
}

async function signInIfNeeded(auth: AuthClient): Promise<string | null> {
  try {
    const { data } = await auth.getSession();
    if (data.session) return data.session.user.id;
    const { data: signedIn, error } = await auth.signInAnonymously();
    if (error || !signedIn.user) return null;
    return signedIn.user.id;
  } catch {
    return null;
  }
}
