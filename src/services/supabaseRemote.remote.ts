// End-to-end sync against the real (development) Supabase project: two phones with the same account,
// through the real adapter. Run with: npm run test:sync:remote (needs .env.local). Leaves one
// anonymous user with the seed behind.
import { createClient } from '@supabase/supabase-js';

import seedJson from '../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { loadSeed, type Seed } from '@/data/seed';
import { countUnsynced, sync } from '@/data/sync';
import { openMemoryDb } from '@/data/testing/memoryDb';

import { supabaseRemote } from './supabaseRemote';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const client = () => createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
const count = async (db: Db, table: string) =>
  (await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${table}`, []))!.n;

(url && key ? describe : describe.skip)('sync against the real project', () => {
  jest.setTimeout(60_000);

  it('phone A uploads the seed; phone B, same account, downloads it all in small pages', async () => {
    const accountA = client();
    const { data, error } = await accountA.auth.signInAnonymously();
    expect(error).toBeNull();

    const a = openMemoryDb();
    await initDb(a, null);
    const ids = (await loadSeed(a, seedJson as Seed))!;
    // pageSize 7: rows uploaded in one batch share server_updated_at, so paging relies on the (time, id) keyset.
    const up = await sync(a, supabaseRemote(accountA), { pageSize: 7 });
    expect(up.pushed).toBe(24 + 5 + 32);
    expect(await countUnsynced(a)).toBe(0);

    const accountB = client();
    await accountB.auth.setSession({
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
    });
    const b = openMemoryDb();
    await initDb(b, null);
    const down = await sync(b, supabaseRemote(accountB), { pageSize: 7 });
    expect(down.pulled).toBe(24 + 5 + 32);
    expect([await count(b, 'exercise'), await count(b, 'session'), await count(b, 'entry')]).toEqual([24, 5, 32]);

    // A stale edit from B loses to A's newer one on the server (last_write_wins migration).
    const id = ids.get('s5e1')!;
    await a.runAsync("UPDATE entry SET reps = '[9,9,9,9]', updated_at = ?, dirty = 1 WHERE id = ?", [
      '2026-09-30T12:00:00.000Z',
      id,
    ]);
    await b.runAsync("UPDATE entry SET reps = '[7,7,7,7]', updated_at = ?, dirty = 1 WHERE id = ?", [
      '2026-09-30T11:00:00.000Z',
      id,
    ]);
    await sync(a, supabaseRemote(accountA), { pageSize: 7 });
    await sync(b, supabaseRemote(accountB), { pageSize: 7 });
    const reps = async (db: Db) => (await db.getFirstAsync<{ reps: string }>('SELECT reps FROM entry WHERE id = ?', [id]))!.reps;
    expect(await reps(b)).toBe('[9,9,9,9]');
    expect(await countUnsynced(b)).toBe(0);
  });
});
