import seedJson from '../../../dev/seed.json';

import type { RemoteExercise } from '@/data/accountSwitch';
import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';

import {
  isAccountSwitchPending,
  resumeAccountSwitch,
  switchToExistingAppleAccount,
  type AccountSwitchDeps,
  type PendingSwitch,
} from './switchAccount';

const APPLE = { idToken: 'apple-id-token', nonce: 'n' };
const SERVER_PRESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Fake services that log every call, so the tests can check the order. */
function fakeDeps(db: Db, opts: { deleteFails?: number; appleFails?: boolean; refreshFails?: boolean } = {}) {
  const log: string[] = [];
  let stored: PendingSwitch | null = null;
  let deleteFailures = opts.deleteFails ?? 0;
  let tokenN = 0;
  const serverExercises: RemoteExercise[] = [
    {
      id: SERVER_PRESS,
      canonical_name: 'Press de hombro con mancuernas',
      aliases: [],
      muscle_groups: ['hombro'],
      kind: 'compound',
      rep_floor: 8,
      rep_top: 12,
      step_kg: 2,
      load_basis: 'per_dumbbell',
      created_at: '2026-06-01T18:00:00.000Z',
      deleted_at: null,
    },
  ];

  const deps: AccountSwitchDeps = {
    db,
    async refreshAnonymousSession() {
      tokenN++;
      log.push('refreshAnonymous');
      return { accessToken: `anon-access-${tokenN}`, refreshToken: `anon-refresh-${tokenN}` };
    },
    async refreshWithToken(refreshToken) {
      log.push(`refreshWith:${refreshToken}`);
      if (opts.refreshFails) throw new Error('offline');
      tokenN++;
      return { accessToken: `anon-access-${tokenN}`, refreshToken: `anon-refresh-${tokenN}` };
    },
    async signInWithApple() {
      log.push('signInWithApple');
      if (opts.appleFails) throw new Error('apple failed');
    },
    async deleteAccount(accessToken) {
      log.push(`delete:${accessToken}`);
      if (deleteFailures > 0) {
        deleteFailures--;
        throw new Error('network');
      }
    },
    async fetchRemoteExercises() {
      log.push('fetchRemote');
      return serverExercises;
    },
    pending: {
      async load() {
        return stored;
      },
      async save(p) {
        log.push(`save:${p.tokens.accessToken}${p.anonymousDeleted ? ':deleted' : ''}`);
        stored = p;
      },
      async clear() {
        log.push('clearPending');
        stored = null;
      },
    },
    async sync() {
      log.push('sync');
    },
  };
  return { deps, log };
}

async function seededDb(): Promise<Db> {
  const db = openMemoryDb();
  await initDb(db, null);
  await loadSeed(db, seedJson as Seed);
  for (const t of ['exercise', 'session', 'entry']) await db.runAsync(`UPDATE ${t} SET dirty = 0`, []);
  return db;
}

const dirtyCount = async (db: Db) =>
  (await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT count(*) FROM exercise WHERE dirty = 1) + (SELECT count(*) FROM entry WHERE dirty = 1) AS n',
    [],
  ))!.n;

describe('switchToExistingAppleAccount', () => {
  it('runs the steps in order: save anonymous token → Apple → delete with it → merge → reupload', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db);

    await expect(switchToExistingAppleAccount(deps, APPLE)).resolves.toBe('done');

    expect(log).toEqual([
      'refreshAnonymous',
      'save:anon-access-1',
      'signInWithApple',
      'delete:anon-access-1',
      'save:anon-access-1:deleted',
      'fetchRemote',
      'clearPending',
      'sync',
    ]);
    // Merged into the account's exercise, and everything marked for upload.
    expect(await db.getFirstAsync('SELECT id FROM exercise WHERE id = ?', [SERVER_PRESS])).not.toBeNull();
    expect(await dirtyCount(db)).toBe(24 + 32);
    expect(await isAccountSwitchPending(deps)).toBe(false);
  });

  it('if the delete fails, nothing is merged or uploaded and the switch stays pending', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db, { deleteFails: 1 });

    await expect(switchToExistingAppleAccount(deps, APPLE)).resolves.toBe('delete_pending');

    expect(log).not.toContain('fetchRemote');
    expect(log).not.toContain('sync');
    expect(await dirtyCount(db)).toBe(0);
    expect(await db.getFirstAsync('SELECT id FROM exercise WHERE id = ?', [SERVER_PRESS])).toBeNull();
    expect(await isAccountSwitchPending(deps)).toBe(true);
  });

  it('a later retry refreshes the saved anonymous token, deletes, and then reuploads', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db, { deleteFails: 1 });
    await switchToExistingAppleAccount(deps, APPLE);
    log.length = 0;

    await expect(resumeAccountSwitch(deps)).resolves.toBe('done');

    expect(log).toEqual([
      'refreshWith:anon-refresh-1',
      'save:anon-access-2',
      'delete:anon-access-2',
      'save:anon-access-2:deleted',
      'fetchRemote',
      'clearPending',
      'sync',
    ]);
    expect(await dirtyCount(db)).toBe(24 + 32);
  });

  it('a retry that still cannot delete keeps waiting', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db, { deleteFails: 2 });
    await switchToExistingAppleAccount(deps, APPLE);
    await expect(resumeAccountSwitch(deps)).resolves.toBe('delete_pending');
    expect(log).not.toContain('sync');
    expect(await isAccountSwitchPending(deps)).toBe(true);
  });

  it('a retry without network to refresh keeps waiting', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db, { deleteFails: 1, refreshFails: true });
    await switchToExistingAppleAccount(deps, APPLE);
    await expect(resumeAccountSwitch(deps)).resolves.toBe('delete_pending');
    expect(log.filter((l) => l.startsWith('delete:'))).toHaveLength(1);
  });

  it('if the app died after the delete, the retry only merges and reuploads', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db);
    await deps.pending.save({ tokens: { accessToken: 'a', refreshToken: 'r' }, anonymousDeleted: true });
    log.length = 0;

    await expect(resumeAccountSwitch(deps)).resolves.toBe('done');
    expect(log).toEqual(['fetchRemote', 'clearPending', 'sync']);
  });

  it('if signing in with Apple fails, nothing is deleted and nothing is pending', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db, { appleFails: true });

    await expect(switchToExistingAppleAccount(deps, APPLE)).rejects.toThrow('apple failed');
    expect(log.some((l) => l.startsWith('delete:'))).toBe(false);
    expect(await isAccountSwitchPending(deps)).toBe(false);
    expect(await dirtyCount(db)).toBe(0);
  });

  it('with nothing pending, resume does nothing', async () => {
    const db = await seededDb();
    const { deps, log } = fakeDeps(db);
    await expect(resumeAccountSwitch(deps)).resolves.toBe('none');
    expect(log).toEqual([]);
  });
});
