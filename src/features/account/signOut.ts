import type { Db } from '@/data/db';
import { countUnsynced, wipeLocalData } from '@/data/sync';

export interface SignOutDeps {
  db: Db;
  sync(): Promise<void>;
  /** Drops the session on this phone. */
  signOut(): Promise<void>;
}

export type SignOutResult = 'signed_out' | 'unsynced';

/**
 * Sign out (MULTIUSER.md §2, §4): sync, and only if nothing is left to upload, wipe the phone's data
 * and then drop the session. Wiping first means a crash in between leaves the same session with an
 * empty database (the next sync downloads everything), never data without a session.
 */
export async function signOutAndWipe(deps: SignOutDeps): Promise<SignOutResult> {
  try {
    await deps.sync();
  } catch {
    // No signal: whatever didn't go up is counted below.
  }
  if ((await countUnsynced(deps.db)) > 0) return 'unsynced';
  await wipeLocalData(deps.db);
  await deps.signOut();
  return 'signed_out';
}
