import seedJson from '../../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { formatSets } from '@/domain/format';
import { startSession } from '@/features/picker/controller';

import { loadSessionScreen, suggestionsFor, textAfterPicking } from './controller';

const TODAY = '2026-09-29';
let db: Db;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  await loadSeed(db, seedJson as Seed);
});

const screenFor = async (groups: string[]) => {
  await startSession(db, groups);
  return (await loadSessionScreen(db, TODAY))!;
};
const lines = (s: Awaited<ReturnType<typeof screenFor>>) =>
  s.plan.map((l) => [l.name, l.loadKg, formatSets(l.reps), l.loadUp ? 'PESO↑' : l.setsUp ? 'SERIES↑' : '=']);

describe('loadSessionScreen (design/meta.html)', () => {
  it('hombro + tríceps: today’s targets, reps going up', async () => {
    const s = await screenFor(['hombro', 'tríceps']);
    expect(s.groupsLabel).toBe('Hombro y tríceps');
    expect(lines(s)).toEqual([
      ['Press de hombro con mancuernas', 24, '4×9', 'SERIES↑'],
      ['Elevaciones laterales en polea', 7.5, '4×11', 'SERIES↑'],
      ['Elevaciones laterales con pecho en rodillas', 12, '4×13', 'SERIES↑'],
      ['Tríceps en polea con barra V (pushdown)', 30, '4×11', 'SERIES↑'],
      ['Extensión de tríceps sobre la cabeza con mancuerna', 20, '3×11', 'SERIES↑'],
    ]);
    expect(s.plan[0].before).toEqual({ loadKg: 24, reps: [8, 8, 8, 8] });
  });

  it('the placeholder is the first target, as it would be dictated', async () => {
    expect((await screenFor(['hombro', 'tríceps'])).placeholder).toBe('press de hombros, 24 kg, 4 de 9');
  });

  it('pierna: the sentadilla goes up in load, with the per-side basis kept', async () => {
    const s = await screenFor(['pierna']);
    expect(lines(s)[0]).toEqual(['Sentadilla en máquina Smith', 32.5, '4×6', 'PESO↑']);
    expect(s.plan[0].loadBasis).toBe('per_side');
    expect(s.placeholder).toBe('sentadilla smith, 32.5 kg, 4 de 6');
  });

  it('an exercise that never had a load has no target and is left out (lumbar on 15 sep)', async () => {
    // Make 15 sep espalda's last session: hide the 17 sep back exercises.
    await db.runAsync(
      `UPDATE entry SET deleted_at = '2026-09-30T00:00:00Z'
       WHERE exercise_id IN (SELECT id FROM exercise WHERE canonical_name IN ('Jalón al pecho en máquina', 'Remo bajo en máquina (low row)'))
         AND created_at > '2026-09-16'`,
      [],
    );
    const s = await screenFor(['espalda']);
    expect(s.plan.map((l) => l.name)).toEqual(['Remo bajo en máquina (low row)']);
  });

  it('groups with no history: no list and the generic placeholder', async () => {
    const s = await screenFor(['core']);
    expect(s.plan).toEqual([]);
    expect(s.placeholder).toBeNull();
  });

  it('no open session → null', async () => {
    expect(await loadSessionScreen(db, TODAY)).toBeNull();
  });
});

describe('suggestionsFor (screen 3)', () => {
  it('"press de hom" → both shoulder presses, bold part and last set', async () => {
    const s = await screenFor(['hombro', 'tríceps']);
    const sug = suggestionsFor('press de hom', s);
    expect(sug.map((x) => x.exercise.canonicalName)).toEqual(['Press de hombro con mancuernas', 'Press de hombro en máquina']);
    const [a, b] = sug[0].highlight!;
    expect(sug[0].exercise.canonicalName.slice(a, b)).toBe('Press de hom');
    expect([sug[0].last!.loadKg, sug[0].last!.reps]).toEqual([24, [8, 8, 8, 8]]);
    expect([sug[1].last!.loadKg, sug[1].exercise.loadBasis]).toEqual([20, 'per_side']);
  });

  it('prefers the session’s groups: "press" puts shoulder presses before the bench press', async () => {
    const s = await screenFor(['hombro']);
    const names = suggestionsFor('press', s).map((x) => x.exercise.canonicalName);
    expect(names.slice(0, 2)).toEqual(['Press de hombro con mancuernas', 'Press de hombro en máquina']);
    expect(names).toHaveLength(3); // the third, from another group, comes after
  });

  it('stops suggesting once there is a comma or a number', async () => {
    const s = await screenFor(['hombro']);
    expect(suggestionsFor('press de hombro con mancuernas, ', s)).toEqual([]);
    expect(suggestionsFor('press 24', s)).toEqual([]);
  });

  it('picking one leaves its name and a comma, ready for the numbers', async () => {
    const s = await screenFor(['hombro']);
    expect(textAfterPicking(suggestionsFor('press de hom', s)[0].exercise)).toBe('Press de hombro con mancuernas, ');
  });
});
