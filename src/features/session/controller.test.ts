import seedJson from '../../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { insertExercise } from '@/data/repos/exercises';
import { createSession, endSession } from '@/data/repos/sessions';
import { formatSets } from '@/domain/format';

import { loadSessionScreen, loadSummary, suggestionsFor, textAfterPicking } from './controller';

const TODAY = '2026-09-29';
let db: Db;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  await loadSeed(db, seedJson as Seed);
});

/** Screen 2 right after EMPEZAR: the groups are only in memory, no session row yet. */
const screenFor = async (groups: string[]) => (await loadSessionScreen(db, TODAY, groups))!;
const lines = (s: Awaited<ReturnType<typeof screenFor>>) =>
  s.plan.map((l) => [l.name, l.loadKg, formatSets(l.reps), l.loadUp ? 'PESO↑' : l.setsUp ? 'SERIES↑' : '=']);

describe('loadSessionScreen (design/meta.html)', () => {
  it('hombro + tríceps: today’s targets, reps going up', async () => {
    const s = await screenFor(['shoulders', 'triceps']);
    expect(s.groupsLabel).toBe('Hombro y tríceps');
    expect(lines(s)).toEqual([
      ['Press de hombro con mancuernas', 24, '4×9', 'SERIES↑'],
      ['Laterales en polea', 7.5, '4×11', 'SERIES↑'],
      ['Laterales con pecho en rodillas', 12, '4×13', 'SERIES↑'],
      ['Tríceps en polea, barra V', 30, '4×11', 'SERIES↑'],
      ['Tríceps sobre la cabeza', 20, '3×11', 'SERIES↑'],
    ]);
    expect(s.plan[0].before).toEqual({ loadKg: 24, reps: [8, 8, 8, 8] });
  });

  it('the placeholder is the first target, as it would be dictated', async () => {
    expect((await screenFor(['shoulders', 'triceps'])).placeholder).toBe('press de hombros, 24 kg, 4 de 9');
  });

  it('pierna: the sentadilla goes up in load, with the per-side basis kept', async () => {
    const s = await screenFor(['legs']);
    expect(lines(s)[0]).toEqual(['Sentadilla en máquina Smith', 32.5, '4×6', 'PESO↑']);
    expect(s.plan[0].loadBasis).toBe('per_side');
    expect(s.placeholder).toBe('sentadilla smith, 32.5 kg, 4 de 6');
  });

  it('an exercise that never had a load has no target and is left out (lumbar on 15 sep)', async () => {
    // Make 15 sep espalda's last session: hide the 17 sep back exercises.
    await db.runAsync(
      `UPDATE entry SET deleted_at = '2026-09-30T00:00:00Z'
       WHERE exercise_id IN (SELECT id FROM exercise WHERE canonical_name IN ('Jalón al pecho en máquina', 'Remo bajo en máquina'))
         AND created_at > '2026-09-16'`,
      [],
    );
    const s = await screenFor(['back']);
    expect(s.plan.map((l) => l.name)).toEqual(['Remo bajo en máquina']);
  });

  it('groups with no history: no list and the generic placeholder', async () => {
    const s = await screenFor(['core']);
    expect(s.plan).toEqual([]);
    expect(s.placeholder).toBeNull();
  });

  it('right after EMPEZAR: no session row, no id, and going back is allowed', async () => {
    const s = await screenFor(['shoulders']);
    expect([s.sessionId, s.canGoBack]).toEqual([null, true]);
    expect(await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM session WHERE ended_at IS NULL', [])).toEqual({ n: 0 });
  });

  it('a session open in the database (it has entries) wins over the groups in memory, and there is no going back', async () => {
    await createSession(db, 'f0000000-0000-4000-8000-00000000000b', ['legs'], '2026-09-29T18:00:00.000Z');
    const s = (await loadSessionScreen(db, TODAY, ['shoulders']))!;
    expect([s.sessionId, s.canGoBack, s.groups]).toEqual(['f0000000-0000-4000-8000-00000000000b', false, ['legs']]);
  });

  it('no open session and no groups in memory → null (the app starts on screen 1)', async () => {
    expect(await loadSessionScreen(db, TODAY, null)).toBeNull();
    expect(await loadSessionScreen(db, TODAY, [])).toBeNull();
  });
});

describe('suggestionsFor (screen 3)', () => {
  it('"press de hom" → both shoulder presses, bold part and last set', async () => {
    const s = await screenFor(['shoulders', 'triceps']);
    const sug = suggestionsFor('press de hom', s);
    expect(sug.map((x) => x.exercise.canonicalName)).toEqual(['Press de hombro con mancuernas', 'Press de hombro en máquina']);
    const [a, b] = sug[0].highlight!;
    expect(sug[0].exercise.canonicalName.slice(a, b)).toBe('Press de hom');
    expect([sug[0].last!.loadKg, sug[0].last!.reps]).toEqual([24, [8, 8, 8, 8]]);
    expect([sug[1].last!.loadKg, sug[1].exercise.loadBasis]).toEqual([20, 'per_side']);
  });

  it('prefers the session’s groups: "press" puts shoulder presses before the bench press', async () => {
    const s = await screenFor(['shoulders']);
    const names = suggestionsFor('press', s).map((x) => x.exercise.canonicalName);
    expect(names.slice(0, 2)).toEqual(['Press de hombro con mancuernas', 'Press de hombro en máquina']);
    expect(names).toHaveLength(3); // the third, from another group, comes after
  });

  it('an exercise already done today goes last, not first (backlog: gym test)', async () => {
    const s = await screenFor(['shoulders']);
    const mancuernas = s.exercises.find((e) => e.canonicalName === 'Press de hombro con mancuernas')!;
    const done = { ...s, today: [{ exerciseId: mancuernas.id } as (typeof s.today)[number]] };
    const names = suggestionsFor('press de hom', done).map((x) => x.exercise.canonicalName);
    expect(names).toEqual(['Press de hombro en máquina', 'Press de hombro con mancuernas']);
  });

  it('stops suggesting once there is a comma or a number', async () => {
    const s = await screenFor(['shoulders']);
    expect(suggestionsFor('press de hombro con mancuernas, ', s)).toEqual([]);
    expect(suggestionsFor('press 24', s)).toEqual([]);
  });

  it('picking one leaves its name and a comma, ready for the numbers', async () => {
    const s = await screenFor(['shoulders']);
    expect(textAfterPicking(suggestionsFor('press de hom', s)[0].exercise)).toBe('Press de hombro con mancuernas, ');
  });
});

describe('the engine sees one exposure per session, its best (PROGRESSION.md §4)', () => {
  it('a lighter second try on 27 sep does not lower today’s target', async () => {
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       SELECT 'f0000000-0000-4000-8000-0000000008a0', e.session_id, e.exercise_id, 16, '[12,12,12,12]', 'x', 'ok',
              strftime('%Y-%m-%dT%H:%M:%fZ', e.created_at, '+20 minutes'), e.updated_at, 1
       FROM entry e JOIN exercise x ON x.id = e.exercise_id
       WHERE x.canonical_name = 'Press de hombro con mancuernas' ORDER BY e.created_at DESC LIMIT 1`,
      [],
    );
    const s = await screenFor(['shoulders', 'triceps']);
    expect(lines(s)[0]).toEqual(['Press de hombro con mancuernas', 24, '4×9', 'SERIES↑']);
  });
});

describe('"Hoy" (screen 4)', () => {
  const log = async (sessionId: string, exerciseName: string, loadKg: number, reps: number[], at: string) => {
    const ex = await db.getFirstAsync<{ id: string }>('SELECT id FROM exercise WHERE canonical_name = ?', [exerciseName]);
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, 'x', 'ok', ?, ?, 1)`,
      [`f0000000-0000-4000-8000-${at.slice(11, 13)}${at.slice(14, 16)}00000000`, sessionId, ex!.id, loadKg, JSON.stringify(reps), at, at],
    );
  };
  const S = 'f0000000-0000-4000-8000-0000000000aa';

  it('what they logged, each against its own last time; the plan keeps only what is left, from the session before', async () => {
    await createSession(db, S, ['shoulders', 'triceps'], '2026-09-29T18:00:00.000Z');
    await insertExercise(db, {
      id: 'f0000000-0000-4000-8000-0000000000bb', canonicalName: 'Remo al mentón', aliases: [], muscleGroups: ['shoulders'],
      kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5, loadBasis: 'total', createdAt: '2026-09-29T18:10:00.000Z',
    });
    await log(S, 'Press de hombro con mancuernas', 24, [9, 9, 9, 9], '2026-09-29T18:00:00.000Z');
    await log(S, 'Remo al mentón', 15, [12, 12, 12], '2026-09-29T18:10:00.000Z');
    const s = (await loadSessionScreen(db, TODAY, null))!;

    expect(s.today.map((t) => [t.name, t.loadKg, formatSets(t.reps), t.comparedTo, t.delta])).toEqual([
      ['Press de hombro con mancuernas', 24, '4×9', '2026-09-27', { kind: 'reps_per_set', diff: 1, tone: 'up' }],
      ['Remo al mentón', 15, '3×12', null, { kind: 'new' }],
    ]);
    expect(lines(s)).toEqual([
      ['Laterales en polea', 7.5, '4×11', 'SERIES↑'],
      ['Laterales con pecho en rodillas', 12, '4×13', 'SERIES↑'],
      ['Tríceps en polea, barra V', 30, '4×11', 'SERIES↑'],
      ['Tríceps sobre la cabeza', 20, '3×11', 'SERIES↑'],
    ]);
  });

  it('the same exercise twice today: the second is compared with the first', async () => {
    await createSession(db, S, ['shoulders'], '2026-09-29T18:00:00.000Z');
    await log(S, 'Press de hombro con mancuernas', 24, [9, 9, 9, 9], '2026-09-29T18:00:00.000Z');
    await log(S, 'Press de hombro con mancuernas', 26, [6, 6], '2026-09-29T18:20:00.000Z');
    const s = (await loadSessionScreen(db, TODAY, null))!;
    expect(s.today.map((t) => [t.comparedTo, t.delta.kind])).toEqual([['2026-09-27', 'reps_per_set'], ['2026-09-29', 'load']]);
  });

  it('a new exercise first does not make today the "last time" of the group: the plan still comes from 27 sep', async () => {
    await createSession(db, S, ['shoulders'], '2026-09-29T18:00:00.000Z');
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       SELECT 'f0000000-0000-4000-8000-0000000000cc', ?, id, 7.5, '[11,11,11,11]', 'x', 'ok', '2026-09-29T18:00:00.000Z', '2026-09-29T18:00:00.000Z', 1
       FROM exercise WHERE canonical_name = 'Laterales en polea'`,
      [S],
    );
    const s = (await loadSessionScreen(db, TODAY, null))!;
    expect(s.plan.map((l) => l.name)).toEqual(['Press de hombro con mancuernas', 'Laterales con pecho en rodillas']);
  });

  it('saved without signal: in "pending" with their words; a doubt or a logged one is not', async () => {
    await createSession(db, S, ['shoulders'], '2026-09-29T18:00:00.000Z');
    await log(S, 'Press de hombro con mancuernas', 24, [9, 9, 9, 9], '2026-09-29T18:00:00.000Z');
    for (const [id, status, text] of [['dd', 'pending', 'laterales 7,5 4 de 11'], ['ee', 'ambiguous', 'laterales con 10']]) {
      await db.runAsync(
        `INSERT INTO entry (id, session_id, raw_text, status, created_at, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [`f0000000-0000-4000-8000-0000000000${id}`, S, text, status, '2026-09-29T18:10:00.000Z', '2026-09-29T18:10:00.000Z'],
      );
    }
    const s = (await loadSessionScreen(db, TODAY, null))!;
    expect(s.pending).toEqual([{ entryId: 'f0000000-0000-4000-8000-0000000000dd', rawText: 'laterales 7,5 4 de 11', createdAt: '2026-09-29T18:10:00.000Z' }]);
    expect(s.today.map((t) => t.name)).toEqual(['Press de hombro con mancuernas']);
  });

  it('right after EMPEZAR there is nothing pending', async () => {
    expect((await loadSessionScreen(db, TODAY, ['shoulders']))!.pending).toEqual([]);
  });
});

describe('loadSummary (screen 7)', () => {
  const S = 'f0000000-0000-4000-8000-0000000000aa';
  let n = 0;
  const log = async (exerciseName: string, loadKg: number | null, reps: number[] | null, at: string, status = 'ok') => {
    const ex = await db.getFirstAsync<{ id: string }>('SELECT id FROM exercise WHERE canonical_name = ?', [exerciseName]);
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?, 1)`,
      [`f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, S, status === 'ok' ? ex!.id : null, loadKg, reps && JSON.stringify(reps), status, at, at],
    );
  };

  it('the mockup’s session: each exercise against its own last time, the count, the minutes and the next time', async () => {
    // Monday 28 sep, 18:00–18:58 local.
    const t = (h: number, m: number) => new Date(2026, 8, 28, h, m).toISOString();
    await createSession(db, S, ['shoulders'], t(18, 0));
    await log('Press de hombro con mancuernas', 24, [9, 9, 9, 9], t(18, 0));
    await log('Laterales en polea', 7.5, [11, 11, 11, 9], t(18, 15));
    await log('Press de hombro en máquina', 20, [12, 12, 12, 12], t(18, 30));
    await log('Press de hombro con mancuernas', 20, [12, 12, 12, 12], t(18, 40)); // again, lighter: the best one counts
    await log('Press de hombro con mancuernas', null, null, t(18, 50), 'pending');
    await endSession(db, S, t(18, 58));

    const s = (await loadSummary(db, S))!;
    expect([s.dayLabel, s.groupsLabel, s.duration, s.pending]).toEqual(['Lunes 28', 'Hombro', '58 min', 1]);
    expect(s.rows.map((r) => [r.name, r.previous?.date, formatSets(r.today.reps), r.verdict])).toEqual([
      ['Press de hombro con mancuernas', '2026-09-27', '4×9', 'up'],
      ['Laterales en polea', '2026-09-27', '3×11 · 1×9', 'up'],
      ['Press de hombro en máquina', '2026-09-17', '4×12', 'same'],
    ]);
    expect(s.tally).toEqual({ up: 2, same: 1, down: 0, new: 0 });
    expect(s.nextTime).toMatchObject({ name: 'Press de hombro en máquina', target: { reason: 'add_load', loadKg: 22.5 } });
  });

  it('compared with the best entry of the session before, not its last one', async () => {
    const t = (d: number, h: number) => new Date(2026, 8, d, h, 0).toISOString();
    const S0 = 'f0000000-0000-4000-8000-0000000000a0';
    await createSession(db, S0, ['shoulders'], t(28, 18));
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       SELECT 'f0000000-0000-4000-8000-0000000009a0', ?, id, 16, '[15,15,15,15]', 'x', 'ok', ?, ?, 1 FROM exercise WHERE canonical_name = 'Press de hombro con mancuernas'`,
      [S0, t(28, 19), t(28, 19)],
    ); // warm-up after the 24 × 4×9… lighter: not the best of 28 sep
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       SELECT 'f0000000-0000-4000-8000-0000000009a1', ?, id, 24, '[9,9,9,9]', 'x', 'ok', ?, ?, 1 FROM exercise WHERE canonical_name = 'Press de hombro con mancuernas'`,
      [S0, t(28, 18), t(28, 18)],
    );
    await endSession(db, S0, t(28, 20));
    await createSession(db, S, ['shoulders'], t(30, 18));
    await log('Press de hombro con mancuernas', 24, [10, 10, 10, 10], t(30, 18));
    await endSession(db, S, t(30, 19));

    const [row] = (await loadSummary(db, S))!.rows;
    expect([row.previous, row.verdict]).toEqual([{ date: '2026-09-28', loadKg: 24, reps: [9, 9, 9, 9], easy: false }, 'up']);
  });

  it('unknown session: null', async () => {
    expect(await loadSummary(db, S)).toBeNull();
  });
});
