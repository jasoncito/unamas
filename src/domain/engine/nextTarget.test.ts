import { formatExposure } from '../format';
import type { ExerciseConfig, ExerciseKind, Exposure } from '../types';
import { nextTarget } from './nextTarget';
import { isNextLoadAbsorbable } from './rules';
import { REP_RANGES } from './params';

// Cases ported from dev/progression_sim.py; expectations are that script's output.
const TODAY = '2026-09-29';

function config(kind: ExerciseKind, stepKg: number): ExerciseConfig {
  const [repFloor, repTop] = REP_RANGES[kind];
  return { kind, repFloor, repTop, stepKg };
}

const x = (date: string, loadKg: number, reps: number[]): Exposure => ({ date, loadKg, reps });
const sets = (n: number, reps: number) => Array<number>(n).fill(reps);

describe('nextTarget · PROGRESSION.md §7 table (real history, today = 29 sep 2026)', () => {
  const table: [string, ExerciseConfig, Exposure[], string, string][] = [
    ['Press de hombro con mancuernas', config('compound', 2),
      [x('2026-09-16', 24, sets(4, 8)), x('2026-09-27', 24, sets(4, 8))], '24 kg · 4×9', 'add_rep'],
    ['Laterales de pie con mancuernas', config('isolation', 2),
      [x('2026-09-16', 16, sets(4, 10)), x('2026-09-17', 16, [12, 12, 12, 10])], '16 kg · 4×12', 'even_out_sets'],
    ['Laterales en polea', config('isolation', 2.5),
      [x('2026-09-27', 7.5, sets(4, 10))], '7.5 kg · 4×11', 'add_rep'],
    ['Laterales con pecho en rodillas', config('isolation', 2),
      [x('2026-09-16', 12, sets(4, 10)), x('2026-09-27', 12, sets(4, 12))], '12 kg · 4×13', 'add_rep'],
    ['Tríceps en polea, barra V', config('isolation', 2.5),
      [x('2026-09-16', 25, sets(3, 10)), x('2026-09-27', 30, sets(4, 10))], '30 kg · 4×11', 'add_rep'],
    ['Curl con barra Z (por lado)', config('isolation', 1.25),
      [x('2026-09-15', 11.5, sets(4, 11)), x('2026-09-17', 12.5, sets(4, 10))], '12.5 kg · 4×11', 'add_rep'],
    ['Sentadilla en Smith (por lado)', config('compound_heavy', 2.5),
      [x('2026-09-24', 30, sets(4, 10))], '32.5 kg · 4×6', 'add_load'],
    ['Leg extension', config('isolation', 5),
      [x('2026-09-24', 70, sets(4, 10))], '70 kg · 4×11', 'add_rep'],
    ['Pantorrilla de pie', config('calf', 2),
      [x('2026-09-24', 18, sets(4, 16))], '18 kg · 4×17', 'add_rep'],
    ['Press en máquina Technogym (por lado)', config('compound', 2.5),
      [x('2026-09-17', 20, sets(4, 12))], '22.5 kg · 4×8', 'add_load'],
  ];

  it.each(table)('%s → %s', (_name, ex, history, expected, reason) => {
    const t = nextTarget(history, ex, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe(expected);
    expect(t.reason).toBe(reason);
  });

  it('laterales en polea: 7.5 → 10 kg is not absorbable, so the top extends to 20', () => {
    const ex = config('isolation', 2.5);
    expect(isNextLoadAbsorbable(7.5, ex)).toBe(false);
    expect(nextTarget([x('2026-09-27', 7.5, sets(4, 10))], ex, TODAY)!.effectiveTop).toBe(20);
  });

  it('laterales de pie: 16 → 18 kg is exactly +0 % e1RM, so it is absorbable', () => {
    expect(isNextLoadAbsorbable(16, config('isolation', 2))).toBe(true);
  });
});

describe('nextTarget · edge cases (PROGRESSION.md §7)', () => {
  const press = config('compound', 2);

  it('4 exposures in a row at 24 kg · 4×8 → light session 24 kg · 2×8', () => {
    const history = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) => x(d, 24, sets(4, 8)));
    const t = nextTarget(history, press, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('24 kg · 2×8');
    expect(t.reason).toBe('stalled_light_session');
  });

  it('3 exposures without progress is not yet a stall (needs 3 comparisons)', () => {
    const history = ['2026-09-13', '2026-09-20', '2026-09-27'].map((d) => x(d, 24, sets(4, 8)));
    expect(nextTarget(history, press, TODAY)!.reason).toBe('add_rep');
  });

  it('curl Z: 12.5 kg · 4×15 → 13.75 kg · 9,8,8,7 → back to 12.5 kg · 4×15', () => {
    const history = [x('2026-09-20', 12.5, sets(4, 15)), x('2026-09-27', 13.75, [9, 8, 8, 7])];
    const t = nextTarget(history, config('isolation', 1.25), TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('12.5 kg · 4×15');
    expect(t.reason).toBe('failed_load_jump');
  });

  it('20 days off → repeat the last exposure', () => {
    const t = nextTarget([x('2026-09-09', 24, sets(4, 8))], press, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('24 kg · 4×8');
    expect(t).toMatchObject({ reason: 'gap_repeat', gapDays: 20 });
  });

  it('40 days off → drop one step (24 → 22 kg) at the floor', () => {
    const t = nextTarget([x('2026-08-20', 24, sets(4, 8))], press, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('22 kg · 4×8');
    expect(t).toMatchObject({ reason: 'long_gap_step_down', gapDays: 40 });
  });

  it('gap thresholds are strict: 14 days progresses, 28 days repeats', () => {
    expect(nextTarget([x('2026-09-15', 24, sets(4, 8))], press, TODAY)!.reason).toBe('add_rep');
    expect(nextTarget([x('2026-09-01', 24, sets(4, 8))], press, TODAY)!.reason).toBe('gap_repeat');
  });

  it('laterales en polea at 4×20 (extended top) → 10 kg · 4×10', () => {
    const t = nextTarget([x('2026-09-27', 7.5, sets(4, 20))], config('isolation', 2.5), TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('10 kg · 4×10');
    expect(t.reason).toBe('add_load');
  });

  it('uneven sets rise at most +2 each, capped at the best set', () => {
    const t = nextTarget([x('2026-09-27', 16, [14, 14, 10, 9])], config('isolation', 2), TODAY)!;
    expect(t.reps).toEqual([14, 14, 12, 11]);
  });

  it('+1 rep never passes the effective top', () => {
    // 20 kg · 4×12 on a compound: 12 is the top → add load, not 13 reps.
    const t = nextTarget([x('2026-09-27', 20, [12, 12, 12, 12])], config('compound', 2.5), TODAY)!;
    expect(t.reason).toBe('add_load');
  });

  it('no history → no target (first time)', () => {
    expect(nextTarget([], press, TODAY)).toBeNull();
  });

  it('light session keeps at least 2 sets and drops 2 reps per set, not below the floor', () => {
    const three = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) => x(d, 24, sets(3, 8)));
    expect(nextTarget(three, press, TODAY)!.reps).toEqual([8, 8]);
    const high = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) => x(d, 24, sets(4, 11)));
    expect(nextTarget(high, press, TODAY)!.reps).toEqual([9, 9]);
  });

  it('below the floor at the same load is not a failed jump', () => {
    // More total reps than last time (so not a bad day), but two sets under the floor of 8.
    const history = [x('2026-09-20', 24, sets(4, 8)), x('2026-09-27', 24, [12, 12, 7, 7])];
    const t = nextTarget(history, press, TODAY)!;
    expect(t).toMatchObject({ reason: 'even_out_sets', reps: [12, 12, 9, 9] });
  });

  it('load arithmetic does not drift with a learned step (5.1 + 1.1)', () => {
    const t = nextTarget([x('2026-09-27', 5.1, sets(4, 20))], config('isolation', 1.1), TODAY)!;
    expect(t).toMatchObject({ reason: 'add_load', loadKg: 6.2 });
  });
});
