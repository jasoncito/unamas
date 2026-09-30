import seedJson from '../../dev/seed.json';

import { nextTarget } from '@/domain/engine';
import { localDateOf } from '@/domain/dates';
import { formatExposure } from '@/domain/format';
import { loadMuscleGroups } from '@/features/picker/controller';

import type { Db } from './db';
import { initDb } from './init';
import { migrate, SCHEMA_VERSION } from './migrations';
import { getAllExercises, getExercise, insertExercise } from './repos/exercises';
import { getExerciseHistory } from './repos/entries';
import { getOpenSession } from './repos/sessions';
import type { Seed } from './seed';
import { openMemoryDb } from './testing/memoryDb';

const seed = seedJson as Seed;

async function count(db: Db, table: string): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${table}`, []))!.n;
}

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
    expect(tables.map((t) => t.name)).toEqual(['entry', 'exercise', 'session']);
  });

  it('running them again does nothing', async () => {
    const db = openMemoryDb();
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('the schema has no confirm_mode / fast_progress columns (derived from history)', async () => {
    const db = openMemoryDb();
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(exercise)', []);
    expect(cols.map((c) => c.name)).not.toEqual(expect.arrayContaining(['confirm_mode']));
    expect(cols.map((c) => c.name)).not.toEqual(expect.arrayContaining(['fast_progress']));
  });

  it('foreign keys are enforced after init', async () => {
    const db = openMemoryDb();
    await initDb(db, null);
    await expect(
      db.runAsync(
        "INSERT INTO entry (id, session_id, raw_text, created_at) VALUES ('e1', 'missing', 'x', '2026-09-29T00:00:00Z')",
        [],
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('checks reject unknown kinds', async () => {
    const db = openMemoryDb();
    await migrate(db);
    await expect(
      db.runAsync(
        `INSERT INTO exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis, created_at)
         VALUES ('x', 'X', '[]', 'cardio', 1, 2, 1, 'total', '2026-09-29')`,
        [],
      ),
    ).rejects.toThrow(/CHECK/);
  });
});

describe('seed', () => {
  let db: Db;
  beforeEach(async () => {
    db = openMemoryDb();
    await initDb(db, seed);
  });

  it('loads every exercise, session and entry', async () => {
    expect(await count(db, 'exercise')).toBe(24);
    expect(await count(db, 'session')).toBe(5);
    expect(await count(db, 'entry')).toBe(32);
  });

  it('loads only once', async () => {
    await initDb(db, seed);
    expect(await count(db, 'entry')).toBe(32);
  });

  it('every seeded session is closed, so the app does not reopen one', async () => {
    expect(await getOpenSession(db)).toBeNull();
  });

  it('keeps the dates of the history', async () => {
    const ex = await getExercise(db, 'press_hombro_mancuernas');
    expect(localDateOf(ex!.createdAt)).toBe('2026-09-16');
    const history = await getExerciseHistory(db, 'press_hombro_mancuernas');
    expect(history.map((h) => localDateOf(h.createdAt))).toEqual(['2026-09-16', '2026-09-27']);
  });

  it('maps JSON columns back to arrays', async () => {
    const ex = await getExercise(db, 'sentadilla_smith');
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
    await initDb(db, mini);
    expect(localDateOf((await getExercise(db, 'a'))!.createdAt)).toBe('2026-09-10');
  });

  it('entries of a session get increasing times inside it', async () => {
    const db = openMemoryDb();
    await initDb(db, mini);
    const rows = await db.getAllAsync<{ id: string; created_at: string; ended_at: string }>(
      "SELECT e.id, e.created_at, s.ended_at FROM entry e JOIN session s ON s.id = e.session_id WHERE s.id = 'late' ORDER BY e.id",
      [],
    );
    expect(rows[0].created_at < rows[1].created_at).toBe(true);
    expect(rows[1].created_at < rows[1].ended_at).toBe(true);
  });
});

describe('queries', () => {
  let db: Db;
  beforeEach(async () => {
    db = openMemoryDb();
    await initDb(db, seed);
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
    const history = await getExerciseHistory(db, 'curl_martillo_polea');
    expect(history.map((h) => h.loadKg)).toEqual([25]); // 15 sep had no load
  });

  it('an open session is found', async () => {
    await db.runAsync("INSERT INTO session (id, muscle_groups, started_at) VALUES ('s9', '[\"hombro\"]', ?)", [
      '2026-09-29T18:00:00.000Z',
    ]);
    expect(await getOpenSession(db)).toMatchObject({ id: 's9', muscleGroups: ['hombro'], endedAt: null });
  });

  it('inserted exercises round-trip', async () => {
    await insertExercise(db, {
      id: 'remo_menton',
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
    expect((await getAllExercises(db)).map((e) => e.id)).toContain('remo_menton');
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
    for (const [id, expected] of cases) {
      const ex = (await getExercise(db, id))!;
      const history = (await getExerciseHistory(db, id)).map((h) => ({
        date: localDateOf(h.createdAt),
        loadKg: h.loadKg,
        reps: h.reps,
      }));
      const t = nextTarget(history, ex, '2026-09-29')!;
      expect([id, formatExposure(t.loadKg, t.reps)]).toEqual([id, expected]);
    }
  });
});
