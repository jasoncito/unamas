import seedJson from '../../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { loadSeed, type Seed } from '@/data/seed';
import { sync } from '@/data/sync';
import { FakeServer } from '@/data/testing/fakeServer';
import { openMemoryDb } from '@/data/testing/memoryDb';

import { signOutAndWipe } from './signOut';

async function seededPhone() {
  const db = openMemoryDb();
  await initDb(db, null);
  const ids = (await loadSeed(db, seedJson as Seed))!;
  return { db, ids };
}

const rows = async (db: Db) =>
  (await db.getFirstAsync<{ n: number }>('SELECT (SELECT count(*) FROM exercise) + (SELECT count(*) FROM entry) AS n', []))!.n;

describe('signOutAndWipe', () => {
  it('syncs, wipes the phone, then signs out', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    const log: string[] = [];
    const result = await signOutAndWipe({
      db,
      sync: async () => {
        log.push('sync');
        await sync(db, server.store());
      },
      signOut: async () => {
        log.push(`signOut (rows left: ${await rows(db)})`);
      },
    });
    expect(result).toBe('signed_out');
    expect(log).toEqual(['sync', 'signOut (rows left: 0)']); // wiped before signing out
    expect(server.rows.entry.size).toBe(32); // everything went up first
  });

  it('without signal it refuses and keeps everything', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    server.offline = true;
    let signedOut = false;
    const result = await signOutAndWipe({
      db,
      sync: () => sync(db, server.store()).then(() => undefined),
      signOut: async () => void (signedOut = true),
    });
    expect(result).toBe('unsynced');
    expect(signedOut).toBe(false);
    expect(await rows(db)).toBe(24 + 32);
  });

  it('a pending entry (never uploaded) also blocks it', async () => {
    const { db, ids } = await seededPhone();
    await db.runAsync("UPDATE entry SET status = 'pending', dirty = 1 WHERE id = ?", [ids.get('s5e1')!]);
    const server = new FakeServer();
    const result = await signOutAndWipe({
      db,
      sync: () => sync(db, server.store()).then(() => undefined),
      signOut: async () => {},
    });
    expect(result).toBe('unsynced');
    expect(await rows(db)).toBe(24 + 32);
  });
});
