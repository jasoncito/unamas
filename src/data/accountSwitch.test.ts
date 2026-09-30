import seedJson from '../../dev/seed.json';

import { markEverythingForUpload, mergeRemoteExercises, type RemoteExercise } from './accountSwitch';
import type { Db } from './db';
import { initDb } from './init';
import { getAllExercises, getExercise } from './repos/exercises';
import { getExerciseHistory } from './repos/entries';
import { loadSeed, type Seed } from './seed';
import { openMemoryDb } from './testing/memoryDb';

const SERVER_PRESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const remote = (over: Partial<RemoteExercise>): RemoteExercise => ({
  id: SERVER_PRESS,
  canonical_name: 'Press de hombro con mancuernas',
  aliases: ['press militar'],
  muscle_groups: ['hombro'],
  kind: 'compound',
  rep_floor: 8,
  rep_top: 12,
  step_kg: 2,
  load_basis: 'per_dumbbell',
  created_at: '2026-06-01T18:00:00.000Z',
  deleted_at: null,
  ...over,
});

describe('mergeRemoteExercises', () => {
  let db: Db;
  let ids: Map<string, string>;
  beforeEach(async () => {
    db = openMemoryDb();
    await initDb(db, null);
    ids = (await loadSeed(db, seedJson as Seed))!;
  });

  it('joins by normalized name: entries move to the server id and the local id disappears', async () => {
    const localPress = ids.get('press_hombro_mancuernas')!;
    // Same name with other case, accents and spacing.
    const merged = await mergeRemoteExercises(db, [remote({ canonical_name: '  PRESS de hómbro con   mancuernas' })]);

    expect(merged).toEqual(new Map([[localPress, SERVER_PRESS]]));
    expect(await getExercise(db, localPress)).toBeNull();
    expect(await getExerciseHistory(db, SERVER_PRESS)).toHaveLength(2);
    expect(await getExerciseHistory(db, localPress)).toEqual([]);
  });

  it('the merged exercise keeps the server data and both alias lists, plus the local name', async () => {
    await mergeRemoteExercises(db, [remote({ canonical_name: 'press de hombro con mancuernas' })]);
    const ex = (await getExercise(db, SERVER_PRESS))!;
    expect(ex.canonicalName).toBe('press de hombro con mancuernas');
    expect(ex.aliases).toEqual(
      expect.arrayContaining(['press militar', 'press de hombros', 'press militar mancuernas', 'Press de hombro con mancuernas']),
    );
    expect(ex.createdAt).toBe('2026-06-01T18:00:00.000Z');
  });

  it('exercises with no exact match stay as new', async () => {
    await mergeRemoteExercises(db, [remote({})]);
    const all = await getAllExercises(db);
    expect(all).toHaveLength(24); // 23 untouched + the merged one
    expect(all.find((e) => e.id === ids.get('curl_barra_z'))).toBeDefined();
  });

  it('never joins by similarity', async () => {
    const merged = await mergeRemoteExercises(db, [
      remote({ canonical_name: 'Press hombro mancuernas' }),
      remote({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', canonical_name: 'Curl barra Z' }), // local: "Curl con barra Z"
    ]);
    expect(merged.size).toBe(0);
    expect(await getAllExercises(db)).toHaveLength(24);
  });

  it('skips exercises deleted on the server', async () => {
    const merged = await mergeRemoteExercises(db, [remote({ deleted_at: '2026-09-01T00:00:00.000Z' })]);
    expect(merged.size).toBe(0);
  });

  it('with two server exercises of the same name, uses the oldest', async () => {
    const older = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await mergeRemoteExercises(db, [
      remote({ created_at: '2026-07-01T00:00:00.000Z' }),
      remote({ id: older, created_at: '2026-05-01T00:00:00.000Z' }),
    ]);
    expect(await getExerciseHistory(db, older)).toHaveLength(2);
  });

  it('two local duplicates go to the same server id', async () => {
    const dup = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.runAsync(
      `INSERT INTO exercise (id, canonical_name, aliases, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
         created_at, updated_at)
       VALUES (?, 'Press de Hombro con Mancuernas', '["press mancuernas"]', '["hombro"]', 'compound', 8, 12, 2,
         'per_dumbbell', '2026-09-28T18:00:00.000Z', '2026-09-28T18:00:00.000Z')`,
      [dup],
    );
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, created_at, updated_at)
       VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ?, ?, 24, '[9,9,9,9]', 'x', '2026-09-28T18:05:00.000Z',
         '2026-09-28T18:05:00.000Z')`,
      [ids.get('s5')!, dup],
    );
    const merged = await mergeRemoteExercises(db, [remote({})]);
    expect(merged.size).toBe(2);
    expect(await getExerciseHistory(db, SERVER_PRESS)).toHaveLength(3);
    expect((await getExercise(db, SERVER_PRESS))!.aliases).toContain('press mancuernas');
  });

  it('running it twice changes nothing the second time', async () => {
    await mergeRemoteExercises(db, [remote({})]);
    const again = await mergeRemoteExercises(db, [remote({})]);
    expect(again.size).toBe(0);
    expect(await getExercise(db, SERVER_PRESS)).not.toBeNull();
    expect(await getExerciseHistory(db, SERVER_PRESS)).toHaveLength(2);
  });

  it('a locally deleted exercise is not merged (that would bring it back)', async () => {
    const localPress = ids.get('press_hombro_mancuernas')!;
    await db.runAsync("UPDATE exercise SET deleted_at = '2026-09-29T00:00:00.000Z' WHERE id = ?", [localPress]);
    const merged = await mergeRemoteExercises(db, [remote({})]);
    expect(merged.size).toBe(0);
    expect(await getExercise(db, SERVER_PRESS)).toBeNull();
  });

  it('merged rows are dirty so they upload to the new account', async () => {
    await mergeRemoteExercises(db, [remote({})]);
    const row = await db.getFirstAsync<{ dirty: number }>('SELECT dirty FROM exercise WHERE id = ?', [SERVER_PRESS]);
    expect(row!.dirty).toBe(1);
  });
});

describe('markEverythingForUpload', () => {
  it('marks every row dirty and forgets the sync cursors', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    await loadSeed(db, seedJson as Seed);
    for (const t of ['exercise', 'session', 'entry']) await db.runAsync(`UPDATE ${t} SET dirty = 0`, []);
    await db.runAsync("INSERT INTO sync_state (table_name, cursor) VALUES ('entry', '2026-09-29T00:00:00Z')", []);

    await markEverythingForUpload(db);

    for (const t of ['exercise', 'session', 'entry']) {
      const clean = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE dirty = 0`, []);
      expect([t, clean!.n]).toEqual([t, 0]);
    }
    expect(await db.getAllAsync('SELECT * FROM sync_state', [])).toEqual([]);
  });
});
