import seedJson from '../../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { createSession } from '@/data/repos/sessions';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { formatSets } from '@/domain/format';

import { loadExerciseTimeline, loadSessionList } from './controller';

let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
});

describe('loadSessionList', () => {
  it('every past session, newest first', async () => {
    expect((await loadSessionList(db, null)).map((s) => s.date)).toEqual([
      '2026-09-27',
      '2026-09-24',
      '2026-09-17',
      '2026-09-16',
      '2026-09-15',
    ]);
  });

  it('a muscle’s history: only sessions that worked it, with only its exercises', async () => {
    const list = await loadSessionList(db, 'shoulders');
    expect(list.map((s) => [s.date, s.groupsLabel])).toEqual([
      ['2026-09-27', 'Hombro y tríceps'],
      ['2026-09-17', 'Pecho, hombro, bíceps y espalda'],
      ['2026-09-16', 'Hombro y tríceps'],
    ]);
    expect(list[0].rows.map((r) => [r.name, r.loadKg, formatSets(r.reps)])).toEqual([
      ['Press de hombro con mancuernas', 24, '4×8'],
      ['Laterales en polea', 7.5, '4×10'],
      ['Laterales con pecho en rodillas', 12, '4×12'],
    ]);
  });

  it('a session counts for a group it didn’t choose when an exercise of that group was logged in it', async () => {
    // Glúteo was never chosen; the sentadilla and the zancadas of 24 sep work it.
    const list = await loadSessionList(db, 'glutes');
    expect(list.map((s) => s.date)).toEqual(['2026-09-24']);
    expect(list[0].rows.map((r) => r.name)).toEqual(['Sentadilla en máquina Smith', 'Zancadas alternas con barra']);
  });

  it('a session still open, an empty one or a deleted one is not in the history', async () => {
    await createSession(db, 'f0000000-0000-4000-8000-0000000000aa', ['shoulders'], '2026-09-29T18:00:00.000Z');
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at)
       VALUES ('f0000000-0000-4000-8000-0000000000ab', 'f0000000-0000-4000-8000-0000000000aa', ?, 24, '[9,9,9,9]', 'x', 'ok', '2026-09-29T18:05:00.000Z', '2026-09-29T18:05:00.000Z')`,
      [ids.get('press_hombro_mancuernas')!],
    );
    await createSession(db, 'f0000000-0000-4000-8000-0000000000ac', ['shoulders'], '2026-09-28T18:00:00.000Z');
    await db.runAsync("UPDATE session SET ended_at = '2026-09-28T19:00:00.000Z' WHERE id = 'f0000000-0000-4000-8000-0000000000ac'", []);
    await db.runAsync("UPDATE session SET deleted_at = '2026-09-30T00:00:00Z' WHERE id = ?", [ids.get('s2')!]);
    expect((await loadSessionList(db, 'shoulders')).map((s) => s.date)).toEqual(['2026-09-27', '2026-09-17']);
  });

  it('a group with no history: nothing', async () => {
    expect(await loadSessionList(db, 'core')).toEqual([]);
  });
});

describe('loadExerciseTimeline', () => {
  it('each time, newest first, against the time before', async () => {
    const verdicts = async (seedId: string) =>
      (await loadExerciseTimeline(db, ids.get(seedId)!))!.rows.map((r) => [r.date, r.loadKg, formatSets(r.reps), r.delta.kind === 'new' ? 'new' : r.delta.tone]);
    expect(await verdicts('laterales_pecho_rodillas')).toEqual([
      ['2026-09-27', 12, '4×12', 'up'],
      ['2026-09-16', 12, '4×10', 'new'],
    ]);
    expect(await verdicts('press_hombro_mancuernas')).toEqual([
      ['2026-09-27', 24, '4×8', 'same'],
      ['2026-09-16', 24, '4×8', 'new'],
    ]);
  });

  it('an exercise that doesn’t exist: null', async () => {
    expect(await loadExerciseTimeline(db, 'f0000000-0000-4000-8000-0000000000ff')).toBeNull();
  });
});
