import { markEverythingForUpload, mergeRemoteExercises, type RemoteExercise } from '@/data/accountSwitch';
import type { Db } from '@/data/db';

export interface AnonymousTokens {
  accessToken: string;
  refreshToken: string;
}

/** Saved on the phone between step 1 and the end, so a failed delete can be retried later. */
export interface PendingSwitch {
  tokens: AnonymousTokens;
  /** The anonymous account is already gone; only steps 4–5 are left. */
  anonymousDeleted: boolean;
}

export interface AppleCredential {
  idToken: string;
  nonce: string;
}

/** Everything the switch touches outside SQLite. Real ones come from Supabase and the Worker; tests fake them. */
export interface AccountSwitchDeps {
  db: Db;
  /** Refreshes the current (anonymous) session and returns its tokens. */
  refreshAnonymousSession(): Promise<AnonymousTokens>;
  /** New tokens from a saved refresh token, without touching the current session. */
  refreshWithToken(refreshToken: string): Promise<AnonymousTokens>;
  signInWithApple(credential: AppleCredential): Promise<void>;
  /** POST /account/delete with this access token. Throws if it fails. */
  deleteAccount(accessToken: string): Promise<void>;
  /** The signed-in account's exercises, including soft-deleted ones. */
  fetchRemoteExercises(): Promise<RemoteExercise[]>;
  pending: {
    load(): Promise<PendingSwitch | null>;
    save(p: PendingSwitch): Promise<void>;
    clear(): Promise<void>;
  };
  sync(): Promise<void>;
}

export type SwitchResult = 'done' | 'delete_pending';

/**
 * Plan B (MULTIUSER.md §2): the Apple ID already has an account, so switch to it and take the local
 * data along. If deleting the anonymous account fails, nothing is uploaded and the switch stays
 * pending for resumeAccountSwitch. Throws if signing in with Apple fails (nothing changed then).
 */
export async function switchToExistingAppleAccount(
  deps: AccountSwitchDeps,
  apple: AppleCredential,
): Promise<SwitchResult> {
  // 1. Fresh anonymous tokens, saved before leaving the anonymous session.
  const tokens = await deps.refreshAnonymousSession();
  await deps.pending.save({ tokens, anonymousDeleted: false });

  // 2. Into the Apple account.
  try {
    await deps.signInWithApple(apple);
  } catch (e) {
    await deps.pending.clear();
    throw e;
  }

  return deleteAnonymousThenReupload(deps, tokens);
}

/** Retries a pending switch (on launch, foreground, network back). 'none' if there is nothing to do. */
export async function resumeAccountSwitch(deps: AccountSwitchDeps): Promise<SwitchResult | 'none'> {
  const pending = await deps.pending.load();
  if (!pending) return 'none';
  if (pending.anonymousDeleted) return reupload(deps);

  // The saved access token may have expired: get new ones with the saved refresh token.
  let tokens: AnonymousTokens;
  try {
    tokens = await deps.refreshWithToken(pending.tokens.refreshToken);
  } catch {
    return 'delete_pending';
  }
  await deps.pending.save({ tokens, anonymousDeleted: false });
  return deleteAnonymousThenReupload(deps, tokens);
}

/** Sync must not upload while a switch is pending: the old ids would clash (MULTIUSER.md §2). */
export async function isAccountSwitchPending(deps: Pick<AccountSwitchDeps, 'pending'>): Promise<boolean> {
  return (await deps.pending.load()) !== null;
}

async function deleteAnonymousThenReupload(deps: AccountSwitchDeps, tokens: AnonymousTokens): Promise<SwitchResult> {
  // 3. Delete the anonymous account with its own token; its server rows go with it.
  try {
    await deps.deleteAccount(tokens.accessToken);
  } catch {
    return 'delete_pending';
  }
  await deps.pending.save({ tokens, anonymousDeleted: true });
  return reupload(deps);
}

async function reupload(deps: AccountSwitchDeps): Promise<SwitchResult> {
  // 4. Join local exercises to the account's by exact normalized name.
  await mergeRemoteExercises(deps.db, await deps.fetchRemoteExercises());
  // 5. Everything up again, pull the account from scratch.
  await markEverythingForUpload(deps.db);
  await deps.pending.clear();
  await deps.sync();
  return 'done';
}
