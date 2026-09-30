import seedJson from '../../dev/seed.json';

import { nextTarget } from '@/domain/engine';
import { localDateOf } from '@/domain/dates';
import { formatExposure } from '@/domain/format';
import { loadMuscleGroups } from '@/features/picker/controller';

import type { Db } from './db';
import { initDb } from './init';
import { migrate, SCHEMA_VERSION } from './migrations';
import { getAllExercises, getExercise, insertExercise, type Exercise } from './repos/exercises';
import { getExerciseHistory } from './repos/entries';
import { getLastTrainedByGroup, getOpenSession } from './repos/sessions';
import { loadSeed, type Seed } from './seed';
import { openMemoryDb } from './testing/memoryDb';

const seed = seedJson as Seed;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function count(db: Db, table: string): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${table}`, []))!.n;
}

/** A db with the seed loaded; returns seed id → UUID. */
async function seeded(db: Db): Promise<Map<string, string>> {
  await initDb(db, null);
  return (await loadSeed(db, seed))!;
}

const remoMenton = (id: string): Exercise => ({
  id,
  canonicalName: 'Remo al mentón',
  aliases: ['remo al menton'],
  muscleGroups: ['hombro'],
  kind: 'compound',
  repFloor: 8,
  repTop: 12,
  stepKg: 2.5,
  loadBasis: 'total',
  createdAt: '2026-09-29T18:00:00.000Z',
});

describe('migrations', () => {
  it('create the schema on an empty database and record the version', async () => {
    const db = openMemoryDb();
    await migrate(db);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(v!.user_version).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.map((t) => t.name)).toEqual(['entry', 'exercise', 'session', 'sync_state']);
  });

  it('running them again does nothing', async () => {
    const db = openMemoryDb();
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it.each(['exercise', 'session', 'entry'])('%s has the sync columns and no user_id (single-user db)', async (table) => {
    const db = openMemoryDb();
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null }>(
      `PRAGMA table_info(${table})`,
      [],
    );
    const col = (name: string) => cols.find((c) => c.name === name);
    expect(col('user_id')).toBeUndefined();
    expect(col('updated_at')).toMatchObject({ notnull: 1 });
    expect(col('deleted_at')).toMatchObject({ notnull: 0 });
    expect(col('dirty')).toMatchObject({ notnull: 1, dflt_value: '1' });
  });

  it('the schema has no confirm_mode / fast_progress columns (derived from history)', async () => {
    const db = openMemoryDb();
    await migrate(db);
    const cols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(exercise)', [])).map((c) => c.name);
    expect(cols).not.toContain('confirm_mode');
    expect(cols).not.toContain('fast_progress');
  });

  it('foreign keys are enforced after init', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    await expect(
      db.runAsync(
        `INSERT INTO entry (id, session_id, raw_text, created_at, updated_at)
         VALUES ('e1', 'missing', 'x', '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')`,
        [],
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('checks reject unknown kinds', async () => {
    const db = openMemoryDb();
    await migrate(db);
    await expect(
      db.runAsync(
        `INSERT INTO exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
           created_at, updated_at)
         VALUES ('x', 'X', '[]', 'cardio', 1, 2, 1, 'total', '2026-09-29', '2026-09-29')`,
        [],
      ),
    ).rejects.toThrow(/CHECK/);
  });
});

describe('seed', () => {
  let db: Db;
  let ids: Map<string, string>;
  beforeEach(async () => {
    db = openMemoryDb();
    ids = await seeded(db);
  });

  it('loads every exercise, session and entry', async () => {
    expect(await count(db, 'exercise')).toBe(24);
    expect(await count(db, 'session')).toBe(5);
    expect(await count(db, 'entry')).toBe(32);
  });

  it('replaces every readable id with a fresh UUID', async () => {
    expect(ids.size).toBe(24 + 5 + 32);
    expect([...ids.values()].every((id) => UUID.test(id))).toBe(true);
    expect(new Set(ids.values()).size).toBe(ids.size);
    const stored = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM exercise UNION ALL SELECT id FROM session UNION ALL SELECT id FROM entry',
      [],
    );
    expect(stored.every((r) => UUID.test(r.id))).toBe(true);
  });

  it('keeps the relations between entries, sessions and exercises', async () => {
    const e = await db.getFirstAsync<{ session_id: string; exercise_id: string }>(
      'SELECT session_id, exercise_id FROM entry WHERE id = ?',
      [ids.get('s1e1')!],
    );
    expect(e).toEqual({ session_id: ids.get('s1'), exercise_id: ids.get('curl_barra_z') });
  });

  it('every seeded row is dirty, so sync will upload it', async () => {
    for (const t of ['exercise', 'session', 'entry']) {
      const clean = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE dirty = 0`, []);
      expect([t, clean!.n]).toEqual([t, 0]);
    }
  });

  it('loads only into an empty database', async () => {
    expect(await loadSeed(db, seed)).toBeNull();
    expect(await count(db, 'entry')).toBe(32);
  });

  it('every seeded session is closed, so the app does not reopen one', async () => {
    expect(await getOpenSession(db)).toBeNull();
  });

  it('keeps the dates of the history', async () => {
    const id = ids.get('press_hombro_mancuernas')!;
    expect(localDateOf((await getExercise(db, id))!.createdAt)).toBe('2026-09-16');
    const history = await getExerciseHistory(db, id);
    expect(history.map((h) => localDateOf(h.createdAt))).toEqual(['2026-09-16', '2026-09-27']);
  });

  it('maps JSON columns back to arrays', async () => {
    const ex = await getExercise(db, ids.get('sentadilla_smith')!);
    expect(ex).toMatchObject({ muscleGroups: ['pierna', 'glúteo'], kind: 'compound_heavy', stepKg: 2.5 });
    expect(ex!.aliases).toContain('sentadilla smith');
  });
});

describe('seed timestamps', () => {
  // Out of order on purpose: the later session comes first in the file.
  const mini: Seed = {
    exercises: [{ ...seed.exercises[0], id: 'a' }],
    sessions: [
      { id: 'late', date: '2026-09-20', muscle_groups: ['bíceps'], duration_min: 30, avg_bpm: null },
      { id: 'early', date: '2026-09-10', muscle_groups: ['bíceps'], duration_min: null, avg_bpm: null },
    ],
    entries: [
      { id: 'l1', session_id: 'late', exercise_id: 'a', load_kg: 12, reps: [10], raw_text: 'x' },
      { id: 'l2', session_id: 'late', exercise_id: 'a', load_kg: 12, reps: [11], raw_text: 'x' },
      { id: 'e1', session_id: 'early', exercise_id: 'a', load_kg: 10, reps: [10], raw_text: 'x' },
    ],
  };

  it('an exercise is created at the first session it appears in, whatever the file order', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    const ids = (await loadSeed(db, mini))!;
    expect(localDateOf((await getExercise(db, ids.get('a')!))!.createdAt)).toBe('2026-09-10');
  });

  it('entries of a session get increasing times inside it', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    const ids = (await loadSeed(db, mini))!;
    const row = (id: string) =>
      db.getFirstAsync<{ created_at: string; ended_at: string }>(
        'SELECT e.created_at, s.ended_at FROM entry e JOIN session s ON s.id = e.session_id WHERE e.id = ?',
        [ids.get(id)!],
      );
    const [l1, l2] = [(await row('l1'))!, (await row('l2'))!];
    expect(l1.created_at < l2.created_at).toBe(true);
    expect(l2.created_at < l2.ended_at).toBe(true);
  });
});

describe('soft delete', () => {
  let db: Db;
  let ids: Map<string, string>;
  const softDelete = (table: string, id: string) =>
    db.runAsync(`UPDATE ${table} SET deleted_at = '2026-09-29T20:00:00.000Z' WHERE id = ?`, [id]);
  beforeEach(async () => {
    db = openMemoryDb();
    ids = await seeded(db);
  });

  it('a deleted exercise disappears from lists and lookups', async () => {
    await softDelete('exercise', ids.get('curl_barra_z')!);
    expect((await getAllExercises(db)).map((e) => e.canonicalName)).not.toContain('Curl con barra Z');
    expect(await getExercise(db, ids.get('curl_barra_z')!)).toBeNull();
  });

  it('a deleted entry leaves the history', async () => {
    await softDelete('entry', ids.get('s5e1')!); // press de hombro, 27 sep
    const history = await getExerciseHistory(db, ids.get('press_hombro_mancuernas')!);
    expect(history.map((h) => localDateOf(h.createdAt))).toEqual(['2026-09-16']);
  });

  it('a deleted session no longer dates its groups, nor counts as open', async () => {
    // s5 (27 sep, hombro + tríceps): delete it and its entries → hombro falls back to 17 sep.
    await softDelete('session', ids.get('s5')!);
    for (const e of ['s5e1', 's5e2', 's5e3', 's5e4', 's5e5']) await softDelete('entry', ids.get(e)!);
    const last = await getLastTrainedByGroup(db);
    expect(localDateOf(last.get('hombro')!)).toBe('2026-09-17');
    await db.runAsync('UPDATE session SET ended_at = NULL WHERE id = ?', [ids.get('s5')!]);
    expect(await getOpenSession(db)).toBeNull();
  });

  it("a deleted exercise's entries no longer date its groups", async () => {
    // Only sentadilla and zancadas train glúteo; deleting both leaves glúteo with no date.
    await softDelete('exercise', ids.get('sentadilla_smith')!);
    expect((await getLastTrainedByGroup(db)).has('glúteo')).toBe(true);
    await softDelete('exercise', ids.get('zancadas_barra')!);
    expect((await getLastTrainedByGroup(db)).has('glúteo')).toBe(false);
  });
});

describe('writes', () => {
  it('an inserted exercise is dirty and gets updated_at', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    await insertExercise(db, remoMenton('33333333-3333-4333-8333-333333333333'));
    const row = await db.getFirstAsync<{ dirty: number; updated_at: string }>('SELECT dirty, updated_at FROM exercise', []);
    expect(row).toMatchObject({ dirty: 1 });
    expect(Number.isNaN(Date.parse(row!.updated_at))).toBe(false);
  });
});

describe('queries on the seed', () => {
  let db: Db;
  let ids: Map<string, string>;
  beforeEach(async () => {
    db = openMemoryDb();
    ids = await seeded(db);
  });

  it('screen 1 lists the groups with their real dates, oldest first', async () => {
    const groups = await loadMuscleGroups(db);
    expect(groups).toEqual([
      { name: 'pecho', lastDate: '2026-09-17' },
      { name: 'espalda', lastDate: '2026-09-17' },
      { name: 'bíceps', lastDate: '2026-09-17' },
      { name: 'pierna', lastDate: '2026-09-24' },
      { name: 'glúteo', lastDate: '2026-09-24' }, // from sentadilla's muscle groups
      { name: 'pantorrilla', lastDate: '2026-09-24' },
      { name: 'tríceps', lastDate: '2026-09-27' },
      { name: 'hombro', lastDate: '2026-09-27' },
      { name: 'core', lastDate: null },
      { name: 'cardio', lastDate: null },
    ]);
  });

  it('history leaves out entries without a load', async () => {
    const history = await getExerciseHistory(db, ids.get('curl_martillo_polea')!);
    expect(history.map((h) => h.loadKg)).toEqual([25]); // 15 sep had no load
  });

  it('seed history + engine reproduce the PROGRESSION.md §7 targets', async () => {
    const cases: [string, string][] = [
      ['press_hombro_mancuernas', '24 kg · 4×9'],
      ['laterales_pie_mancuernas', '16 kg · 4×12'],
      ['laterales_polea', '7.5 kg · 4×11'],
      ['laterales_pecho_rodillas', '12 kg · 4×13'],
      ['pushdown_barra_v', '30 kg · 4×11'],
      ['curl_barra_z', '12.5 kg · 4×11'],
      ['sentadilla_smith', '32.5 kg · 4×6'],
      ['leg_extension', '70 kg · 4×11'],
      ['pantorrilla_pie_mancuerna', '18 kg · 4×17'],
      ['press_hombro_maquina', '22.5 kg · 4×8'],
    ];
    for (const [seedId, expected] of cases) {
      const id = ids.get(seedId)!;
      const ex = (await getExercise(db, id))!;
      const history = (await getExerciseHistory(db, id)).map((h) => ({
        date: localDateOf(h.createdAt),
        loadKg: h.loadKg,
        reps: h.reps,
      }));
      const t = nextTarget(history, ex, '2026-09-29')!;
      expect([seedId, formatExposure(t.loadKg, t.reps)]).toEqual([seedId, expected]);
    }
  });
});
