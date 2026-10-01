import { REP_RANGES } from './engine';
import { dictationOf, groupsLabel, planRow } from './plan';
import type { ExerciseKind, Exposure } from './types';

const TODAY = '2026-09-29';
const ex = (id: string, kind: ExerciseKind, stepKg: number) => {
  const [repFloor, repTop] = REP_RANGES[kind];
  return { id, kind, repFloor, repTop, stepKg };
};
const x = (date: string, loadKg: number, reps: number[]): Exposure => ({ date, loadKg, reps });
const sets = (n: number, r: number) => Array<number>(n).fill(r);

describe('planRow (design/meta.html)', () => {
  it('press de hombro: more reps → SERIES goes up, PESO stays', () => {
    const row = planRow(ex('press', 'compound', 2), [x('2026-09-16', 24, sets(4, 8)), x('2026-09-27', 24, sets(4, 8))], TODAY)!;
    expect(row).toEqual({
      exerciseId: 'press',
      loadKg: 24,
      reps: sets(4, 9),
      loadUp: false,
      setsUp: true,
      before: { loadKg: 24, reps: sets(4, 8) },
    });
  });

  it('sentadilla: load goes up → PESO goes up; SERIES back to the floor is not "up"', () => {
    const row = planRow(ex('smith', 'compound_heavy', 2.5), [x('2026-09-24', 30, sets(4, 10))], TODAY)!;
    expect(row).toMatchObject({ loadKg: 32.5, reps: sets(4, 6), loadUp: true, setsUp: false, before: { loadKg: 30 } });
  });

  it('evening out uneven sets counts as more reps', () => {
    const row = planRow(ex('lat', 'isolation', 2), [x('2026-09-27', 16, [12, 12, 12, 10])], TODAY)!;
    expect(row).toMatchObject({ reps: sets(4, 12), setsUp: true, loadUp: false });
  });

  it('nothing goes up after a long break: repeat → both stay white', () => {
    const row = planRow(ex('press', 'compound', 2), [x('2026-09-09', 24, sets(4, 8))], TODAY)!;
    expect(row).toMatchObject({ loadUp: false, setsUp: false });
  });

  it('a lower load (40 days off) is not "up"', () => {
    const row = planRow(ex('press', 'compound', 2), [x('2026-08-20', 24, sets(4, 8))], TODAY)!;
    expect(row).toMatchObject({ loadKg: 22, loadUp: false, setsUp: false });
  });

  it('a light session (fewer sets) is not "up"', () => {
    const history = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) => x(d, 24, sets(4, 8)));
    expect(planRow(ex('press', 'compound', 2), history, TODAY)).toMatchObject({ reps: sets(2, 8), setsUp: false });
  });

  it('after a failed load jump: back to the old load with more reps is not "up" (the before was a heavier load)', () => {
    const history = [x('2026-09-20', 12.5, sets(4, 15)), x('2026-09-27', 13.75, [9, 8, 8, 7])];
    expect(planRow(ex('curl', 'isolation', 1.25), history, TODAY)).toMatchObject({ loadKg: 12.5, loadUp: false, setsUp: false });
  });

  it('no history → no row', () => {
    expect(planRow(ex('new', 'compound', 2), [], TODAY)).toBeNull();
  });
});

describe('dictationOf', () => {
  it('reads like a dictated entry', () => {
    expect(dictationOf('press de hombros', 24, sets(4, 9))).toBe('press de hombros, 24 kg, 4 de 9');
    expect(dictationOf('sentadilla smith', 32.5, sets(4, 6))).toBe('sentadilla smith, 32.5 kg, 4 de 6');
  });

  it('uneven sets are listed', () => {
    expect(dictationOf('laterales', 16, [12, 12, 12, 10])).toBe('laterales, 16 kg, 12, 12, 12, 10');
  });
});

describe('groupsLabel', () => {
  it.each([
    [['Hombro'], 'Hombro'],
    [['Hombro', 'Tríceps'], 'Hombro y tríceps'],
    [['Pecho', 'Espalda', 'Bíceps'], 'Pecho, espalda y bíceps'],
    [['antebrazo'], 'Antebrazo'],
    [[], ''],
  ])('%j → %s', (groups, label) => {
    expect(groupsLabel(groups)).toBe(label);
  });
});
