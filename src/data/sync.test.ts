import seedJson from '../../dev/seed.json';

import { localDateOf } from '@/domain/dates';
import { loadMuscleGroups } from '@/features/picker/controller';

import type { Db } from './db';
import { initDb } from './init';
import { getAllExercises } from './repos/exercises';
import { getExerciseHistory } from './repos/entries';
import { loadSeed, type Seed } from './seed';
import { countUnsynced, CURSOR_MARGIN_MS, PULL_PAGE_SIZE, sync, timeKey, wipeLocalData } from './sync';
import { FakeServer } from './testing/fakeServer';
import { openMemoryDb } from './testing/memoryDb';

const seed = seedJson as Seed;

async function phone(): Promise<Db> {
  const db = openMemoryDb();
  await initDb(db, null);
  return db;
}

async function seededPhone(): Promise<{ db: Db; ids: Map<string, string> }> {
  const db = await phone();
  return { db, ids: (await loadSeed(db, seed))! };
}

const count = async (db: Db, table: string, where = '1') =>
  (await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, []))!.n;

/** A local edit, the way repos will do it: new updated_at and dirty. */
const edit = (db: Db, table: string, id: string, set: string, at: string) =>
  db.runAsync(`UPDATE ${table} SET ${set}, updated_at = ?, dirty = 1 WHERE id = ?`, [at, id]);

describe('offline → online', () => {
  it('without signal nothing is lost and everything stays dirty', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    server.offline = true;
    await expect(sync(db, server.store())).rejects.toThrow(/Network/);
    expect(await countUnsynced(db)).toBe(24 + 5 + 32);
  });

  it('when the signal is back, everything goes up and is marked clean', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    server.offline = true;
    await sync(db, server.store()).catch(() => {});
    server.offline = false;

    const result = await sync(db, server.store());

    expect(result.pushed).toBe(24 + 5 + 32);
    expect(await countUnsynced(db)).toBe(0);
    expect([server.rows.exercise.size, server.rows.session.size, server.rows.entry.size]).toEqual([24, 5, 32]);
  });

  it('uploads parents before children (the server checks foreign keys)', async () => {
    const { db } = await seededPhone();
    await expect(sync(db, new FakeServer().store())).resolves.toBeDefined();
  });

  it('never sends user_id or dirty', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    await sync(db, server.store());
    const row = [...server.rows.entry.values()][0];
    expect(row).not.toHaveProperty('user_id');
    expect(row).not.toHaveProperty('dirty');
    expect(Array.isArray(row.reps)).toBe(true); // JSON text → array (jsonb)
  });

  it('pending or ambiguous entries stay on the phone', async () => {
    const { db, ids } = await seededPhone();
    await edit(db, 'entry', ids.get('s5e1')!, "status = 'pending', exercise_id = NULL", '2026-09-29T18:00:00.000Z');
    const server = new FakeServer();
    await sync(db, server.store());
    expect(server.rows.entry.has(ids.get('s5e1')!)).toBe(false);
    expect(await countUnsynced(db)).toBe(1);
  });

  it('an edit made while uploading stays dirty for the next sync', async () => {
    const { db, ids } = await seededPhone();
    const server = new FakeServer();
    server.onUpsert = async (table) => {
      if (table === 'entry') {
        await edit(db, 'entry', ids.get('s5e1')!, "reps = '[9,9,9,9]'", '2026-09-29T19:00:00.000Z');
        server.onUpsert = null;
      }
    };
    await sync(db, server.store());
    expect(await count(db, 'entry', `dirty = 1 AND id = '${ids.get('s5e1')}'`)).toBe(1);

    await sync(db, server.store());
    expect(server.rows.entry.get(ids.get('s5e1')!)!.reps).toEqual([9, 9, 9, 9]);
    expect(await countUnsynced(db)).toBe(0);
  });

  it('uploads nothing while an account switch is pending, but still downloads', async () => {
    const { db } = await seededPhone();
    const server = new FakeServer();
    const result = await sync(db, server.store(), { canUpload: async () => false });
    expect(result.pushed).toBe(0);
    expect(server.rows.entry.size).toBe(0);
    expect(await countUnsynced(db)).toBe(24 + 5 + 32);
  });
});

describe('a second phone', () => {
  it('downloads everything, with the same ids and dates, all clean', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());

    const b = await phone();
    const result = await sync(b, server.store());

    expect(result.pulled).toBe(24 + 5 + 32);
    expect([await count(b, 'exercise'), await count(b, 'session'), await count(b, 'entry')]).toEqual([24, 5, 32]);
    expect(await countUnsynced(b)).toBe(0);
    expect(await loadMuscleGroups(b)).toEqual(await loadMuscleGroups(a.db));
    const press = a.ids.get('press_hombro_mancuernas')!;
    expect(await getExerciseHistory(b, press)).toEqual(await getExerciseHistory(a.db, press));
  });

  it('stores server timestamps normalized (ISO with Z)', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    expect([...server.rows.entry.values()][0].created_at).toMatch(/\+00:00$/);

    const b = await phone();
    await sync(b, server.store());
    const row = await b.getFirstAsync<{ created_at: string }>('SELECT created_at FROM entry', []);
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("gets the other phone's later edits", async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());

    await edit(a.db, 'entry', a.ids.get('s5e1')!, "reps = '[10,10,10,9]'", '2026-09-29T20:00:00.000Z');
    await sync(a.db, server.store());
    await sync(b, server.store());

    const r = await b.getFirstAsync<{ reps: string; dirty: number }>('SELECT reps, dirty FROM entry WHERE id = ?', [
      a.ids.get('s5e1')!,
    ]);
    expect(r).toEqual({ reps: '[10,10,10,9]', dirty: 0 });
  });

  it('syncing again with no changes changes nothing', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const before = await a.db.getAllAsync('SELECT * FROM entry ORDER BY id', []);
    const again = await sync(a.db, server.store());
    expect(again.pushed).toBe(0);
    expect(await a.db.getAllAsync('SELECT * FROM entry ORDER BY id', [])).toEqual(before);
  });
});

describe('conflicts: last write wins by updated_at', () => {
  async function twoPhones() {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());
    return { a, b, server, id: a.ids.get('s5e1')! };
  }
  const repsOf = async (db: Db, id: string) =>
    (await db.getFirstAsync<{ reps: string }>('SELECT reps FROM entry WHERE id = ?', [id]))!.reps;

  it('the later edit wins on both phones and on the server, even if the older one uploads last', async () => {
    const { a, b, server, id } = await twoPhones();
    await edit(a.db, 'entry', id, "reps = '[8,8,8,8]'", '2026-09-29T20:00:00.000Z');
    await edit(b, 'entry', id, "reps = '[9,9,9,9]'", '2026-09-29T20:05:00.000Z'); // later
    await sync(b, server.store());
    await sync(a.db, server.store()); // A uploads its older edit after B: the server keeps B's
    await sync(b, server.store());

    expect(server.rows.entry.get(id)!.reps).toEqual([9, 9, 9, 9]);
    expect(await repsOf(a.db, id)).toBe('[9,9,9,9]');
    expect(await repsOf(b, id)).toBe('[9,9,9,9]');
    expect(await countUnsynced(a.db)).toBe(0);
  });

  it('a dirty local row newer than the server row is kept and uploaded', async () => {
    const { a, b, server, id } = await twoPhones();
    await edit(a.db, 'entry', id, "reps = '[8,8,8,8]'", '2026-09-29T20:00:00.000Z');
    await sync(a.db, server.store());
    await edit(b, 'entry', id, "reps = '[9,9,9,9]'", '2026-09-29T20:05:00.000Z');
    // B pulls A's older version first (no upload), then uploads its own.
    await sync(b, server.store(), { canUpload: async () => false });
    expect(await repsOf(b, id)).toBe('[9,9,9,9]');
    await sync(b, server.store());
    expect(server.rows.entry.get(id)!.reps).toEqual([9, 9, 9, 9]);
  });

  it('a dirty local row older than the server row loses', async () => {
    const { a, b, server, id } = await twoPhones();
    await edit(b, 'entry', id, "reps = '[9,9,9,9]'", '2026-09-29T20:00:00.000Z');
    await edit(a.db, 'entry', id, "reps = '[8,8,8,8]'", '2026-09-29T20:05:00.000Z'); // later
    await sync(a.db, server.store());
    await sync(b, server.store(), { canUpload: async () => false });
    expect(await repsOf(b, id)).toBe('[8,8,8,8]');
    expect(await count(b, 'entry', `id = '${id}' AND dirty = 1`)).toBe(0);
  });

  it('compares instants, not text, when the server has microseconds', async () => {
    const { b, server, id } = await twoPhones();
    await edit(b, 'entry', id, "reps = '[9,9,9,9]'", '2026-09-29T20:00:00.000Z');
    // The server's row is 0.4 ms newer. As text "…00.000Z" > "…00.000400+00:00", as instants it's older.
    const stored = server.rows.entry.get(id)!;
    server.commitLate('entry', { ...stored, reps: [7, 7, 7, 7], updated_at: '2026-09-29T20:00:00.000400Z' }, server.now());
    await sync(b, server.store(), { canUpload: async () => false });
    expect(await repsOf(b, id)).toBe('[7,7,7,7]');
  });

  it('compares instants, not text (+00:00 vs Z)', async () => {
    const { a, b, server, id } = await twoPhones();
    // Same instant written two ways: the server's "+00:00" must not look newer than the local "Z".
    await edit(a.db, 'entry', id, "reps = '[8,8,8,8]'", '2026-09-29T20:00:00.000Z');
    await sync(a.db, server.store());
    await edit(b, 'entry', id, "reps = '[9,9,9,9]'", '2026-09-29T20:00:00.001Z'); // 1 ms later
    await sync(b, server.store(), { canUpload: async () => false });
    expect(await repsOf(b, id)).toBe('[9,9,9,9]');
  });
});

describe('soft delete', () => {
  it('a deletion on one phone disappears on the other', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());
    const press = a.ids.get('press_hombro_mancuernas')!;

    await edit(a.db, 'entry', a.ids.get('s5e1')!, "deleted_at = '2026-09-29T21:00:00.000Z'", '2026-09-29T21:00:00.000Z');
    await edit(a.db, 'exercise', a.ids.get('curl_barra_z')!, "deleted_at = '2026-09-29T21:00:00.000Z'", '2026-09-29T21:00:00.000Z');
    await sync(a.db, server.store());
    await sync(b, server.store());

    expect((await getExerciseHistory(b, press)).map((h) => localDateOf(h.createdAt))).toEqual(['2026-09-16']);
    expect((await getAllExercises(b)).map((e) => e.canonicalName)).not.toContain('Curl con barra Z');
  });
});

describe('the cursor never loses rows', () => {
  it('pulls again the last 60 s before the cursor', () => {
    expect(CURSOR_MARGIN_MS).toBe(60_000);
  });

  it('a row committed late, with server_updated_at before the cursor, still arrives', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());
    const cursor = (await b.getFirstAsync<{ cursor: string }>("SELECT cursor FROM sync_state WHERE table_name = 'session'", []))!.cursor;

    // A transaction that started 30 s before B's cursor commits only now (now() = its start).
    const startedAt = new Date(timeKey(cursor) / 1000 - 30_000).toISOString().replace('Z', '000+00:00');
    server.commitLate(
      'session',
      { id: 'f0000000-0000-4000-8000-000000000001', muscle_groups: ['core'], started_at: '2026-09-29T18:00:00Z',
        ended_at: null, avg_bpm: null, updated_at: '2026-09-29T18:00:00Z', deleted_at: null },
      startedAt,
    );
    await sync(b, server.store());

    expect(await count(b, 'session', "id = 'f0000000-0000-4000-8000-000000000001'")).toBe(1);
  });

  it('the cursor does not go backwards when only margin rows come back', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const read = async () => (await a.db.getAllAsync('SELECT * FROM sync_state ORDER BY table_name', []));
    const before = await read();
    await sync(a.db, server.store());
    expect(await read()).toEqual(before);
  });

  it('pages through many rows sharing the same millisecond without looping or skipping', async () => {
    const a = await seededPhone();
    // 1 µs per row: hundreds of rows in the same millisecond, more than one page.
    const server = new FakeServer(1);
    for (let i = 0; i < PULL_PAGE_SIZE + 20; i++) {
      await a.db.runAsync(
        `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, created_at, updated_at)
         SELECT ?, session_id, exercise_id, 20, '[10]', 'x', created_at, created_at FROM entry LIMIT 1`,
        [`e${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`],
      );
    }
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());
    expect(await count(b, 'entry')).toBe(32 + PULL_PAGE_SIZE + 20);
  });

  it('a session and entry written between two reads never leave an orphan entry', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await sync(b, server.store());

    // Another phone uploads a new session and its entry right after B reads the entry table.
    const exerciseId = a.ids.get('press_hombro_mancuernas')!;
    server.onPull = async (table) => {
      if (table !== 'entry') return;
      server.onPull = null;
      await server.store().upsert('session', [
        { id: 'f0000000-0000-4000-8000-000000000002', muscle_groups: ['hombro'], started_at: '2026-09-30T18:00:00.000Z',
          ended_at: null, avg_bpm: null, updated_at: '2026-09-30T18:00:00.000Z', deleted_at: null },
      ]);
      await server.store().upsert('entry', [
        { id: 'f0000000-0000-4000-8000-000000000003', session_id: 'f0000000-0000-4000-8000-000000000002',
          exercise_id: exerciseId, load_kg: 24, reps: [9, 9, 9, 9], raw_text: 'x', rir_note: null, status: 'ok',
          created_at: '2026-09-30T18:05:00.000Z', updated_at: '2026-09-30T18:05:00.000Z', deleted_at: null },
      ]);
    };
    await expect(sync(b, server.store())).resolves.toBeDefined();
    await sync(b, server.store());
    expect(await count(b, 'entry', "id = 'f0000000-0000-4000-8000-000000000003'")).toBe(1);
  });

  it('applies downloaded rows parents first (entries need their session and exercise)', async () => {
    const a = await seededPhone();
    const server = new FakeServer();
    await sync(a.db, server.store());
    const b = await phone();
    await expect(sync(b, server.store())).resolves.toBeDefined(); // foreign keys are on
  });
});

describe('sign-out helpers', () => {
  it('countUnsynced counts pending entries too', async () => {
    const { db, ids } = await seededPhone();
    await sync(db, new FakeServer().store());
    await edit(db, 'entry', ids.get('s5e1')!, "status = 'ambiguous'", '2026-09-29T18:00:00.000Z');
    expect(await countUnsynced(db)).toBe(1);
  });

  it('wipeLocalData empties the data and the cursors', async () => {
    const { db } = await seededPhone();
    await sync(db, new FakeServer().store());
    await wipeLocalData(db);
    for (const t of ['exercise', 'session', 'entry', 'sync_state']) expect([t, await count(db, t)]).toEqual([t, 0]);
  });
});
