import { aimRange, parseReps, prefillReps } from './reps';
import type { ExerciseConfig } from './types';

// Sentadilla Smith in the seed: 30 kg per side, 6–10, steps of 2.5.
const smith: ExerciseConfig = { kind: 'compound_heavy', repFloor: 6, repTop: 10, stepKg: 2.5 };
// Laterales en polea: 7.5 kg, 10–15, steps of 2.5 — the next plate is +33 %, not absorbable.
const laterales: ExerciseConfig = { kind: 'isolation', repFloor: 10, repTop: 15, stepKg: 2.5 };

describe('parseReps', () => {
  it.each([
    ['4 de 9', [9, 9, 9, 9]],
    ['3 de 8 y una de 7', [8, 8, 8, 7]],
    ['3 de 11 y la última de 9', [11, 11, 11, 9]],
    ['4x10', [10, 10, 10, 10]],
    ['4 x 10', [10, 10, 10, 10]],
    ['3×12', [12, 12, 12]],
    ['3 por 10', [10, 10, 10]],
    ['8 8 7', [8, 8, 7]],
    ['8, 8, 7', [8, 8, 7]],
    ['10,10,9', [10, 10, 9]],
    ['tres de ocho y una de siete', [8, 8, 8, 7]],
    ['Cuatro series de diez', [10, 10, 10, 10]],
    ['2 de 10, 2 de 8', [10, 10, 8, 8]],
    ['3 de 10 reps', [10, 10, 10]],
    ['una de 12 y otra de 10', [12, 10]],
    ['12', [12]],
  ])('"%s" → %j', (text, reps) => {
    expect(parseReps(text)).toEqual(reps);
  });

  it.each([
    [''],
    ['  '],
    ['me sobraron dos'],
    ['24 kg, 4 de 9'], // a load in the phrase: better to ask /parse than to guess
    ['3 de 8 fácil'],
    ['0 0 0'],
    ['4 de 0'],
    ['30 de 10'], // 30 sets: not a real answer
    ['3 de 150'],
  ])('"%s" → null (the AI is asked)', (text) => {
    expect(parseReps(text)).toBeNull();
  });
});

describe('aimRange: the engine’s range for that load', () => {
  it('the exercise’s range when the next load would be absorbable', () => {
    expect(aimRange(smith, 32.5)).toEqual([6, 10]);
  });

  it('the top extended +5 when the next plate is too big a jump (PROGRESSION.md §3.3)', () => {
    expect(aimRange(laterales, 7.5)).toEqual([10, 20]);
  });
});

describe('prefillReps', () => {
  const last = { loadKg: 30, reps: [10, 10, 10, 10] };

  it('same load: last time +1 per set, as many sets as last time', () => {
    expect(prefillReps(smith, 30, { loadKg: 30, reps: [8, 8, 7] })).toEqual([9, 9, 8]);
  });

  it('same load: never past the top', () => {
    expect(prefillReps(smith, 30, last)).toEqual([10, 10, 10, 10]);
  });

  it('more load: the floor of the range, one per set of last time', () => {
    expect(prefillReps(smith, 32.5, last)).toEqual([6, 6, 6, 6]);
  });

  it('less load: like repeating it (+1, up to the top)', () => {
    expect(prefillReps(smith, 27.5, { loadKg: 30, reps: [7, 7] })).toEqual([8, 8]);
  });

  it('no last time: three sets at the floor', () => {
    expect(prefillReps(smith, 20, null)).toEqual([6, 6, 6]);
  });
});
