import { formatExposure } from '../format';
import type { ExerciseConfig, ExerciseKind, Exposure } from '../types';
import { nextTarget } from './nextTarget';
import { REP_RANGES } from './params';
import { learnProfile } from './profile';

// PROGRESSION.md §6 and §6.1: what the engine learns per exercise from the history alone.
const TODAY = '2026-09-29';

function config(kind: ExerciseKind, stepKg: number): ExerciseConfig {
  const [repFloor, repTop] = REP_RANGES[kind];
  return { kind, repFloor, repTop, stepKg };
}

const x = (date: string, loadKg: number, reps: number[], easy?: boolean): Exposure => ({
  date,
  loadKg,
  reps,
  ...(easy && { easy }),
});
const sets = (n: number, reps: number) => Array<number>(n).fill(reps);
/** Weekly dates ending on 27 sep, oldest first. */
const weeks = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 27 - 7 * (n - 1 - i)));
    return d.toISOString().slice(0, 10);
  });

const press = config('compound', 2); // 8–12
const curl = config('isolation', 1.25); // 10–15

describe('rep range recentering', () => {
  it('always 16 on a compound (8–12) → range 14–19', () => {
    const p = learnProfile([x('2026-09-20', 10, sets(3, 16)), x('2026-09-27', 10, sets(3, 16))], press);
    expect([p.repFloor, p.repTop]).toEqual([14, 19]);
  });

  it('always under the floor → recenters down', () => {
    const p = learnProfile([x('2026-09-20', 30, sets(4, 5)), x('2026-09-27', 30, sets(4, 6))], press);
    expect([p.repFloor, p.repTop]).toEqual([4, 9]); // median of 5,5,5,5,6,6,6,6 = 5.5 → 6
  });

  it('only one exposure out of range → keeps the range', () => {
    const p = learnProfile([x('2026-09-20', 10, sets(3, 16)), x('2026-09-27', 10, sets(3, 12))], press);
    expect([p.repFloor, p.repTop]).toEqual([8, 12]);
  });

  it('only the first 2 exposures count', () => {
    const p = learnProfile(
      [x('2026-09-13', 10, sets(3, 10)), x('2026-09-20', 10, sets(3, 11)), x('2026-09-27', 10, sets(3, 16))],
      press,
    );
    expect([p.repFloor, p.repTop]).toEqual([8, 12]);
  });

  it('the recentered range drives the target', () => {
    // 3×19 at the new top of 19 → add load, back to the new floor of 14.
    const history = [x('2026-09-13', 40, sets(3, 16)), x('2026-09-20', 40, sets(3, 16)), x('2026-09-27', 40, sets(3, 19))];
    const t = nextTarget(history, press, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('42 kg · 3×14');
  });
});

describe('learned step', () => {
  it('a smaller jump shrinks the step: 16 → 17.5 with step 2 makes it 1.5', () => {
    const p = learnProfile([x('2026-09-20', 16, sets(4, 15)), x('2026-09-27', 17.5, sets(4, 12))], config('isolation', 2));
    expect(p.stepKg).toBe(1.5);
  });

  it('a bigger jump never grows the step: tríceps 25 → 30 keeps 2.5', () => {
    const history = [x('2026-09-16', 25, sets(3, 10)), x('2026-09-27', 30, sets(4, 10))];
    expect(learnProfile(history, config('isolation', 2.5)).stepKg).toBe(2.5);
  });

  it('the smallest jump seen wins, and decreases do not count', () => {
    const history = [
      x('2026-09-06', 20, sets(4, 15)),
      x('2026-09-13', 21, sets(4, 12)), // +1
      x('2026-09-20', 18, sets(4, 15)), // −3: ignored
      x('2026-09-27', 22, sets(4, 12)), // +4: bigger, ignored
    ];
    expect(learnProfile(history, config('isolation', 2)).stepKg).toBe(1);
  });

  it('with the default step, the next jump from 30 kg is to 32.5 kg', () => {
    const history = [x('2026-09-16', 25, sets(4, 15)), x('2026-09-27', 30, sets(4, 15))];
    expect(nextTarget(history, config('isolation', 2.5), TODAY)!).toMatchObject({ reason: 'add_load', loadKg: 32.5 });
  });

  it('the learned step is used when stepping down after a long break', () => {
    // Base step 2.5, learned 1.5 from 20 → 21.5; 43 days off → 21.5 − 1.5 = 20.
    const history = [x('2026-08-10', 20, sets(4, 12)), x('2026-08-17', 21.5, sets(4, 8))];
    const t = nextTarget(history, config('compound', 2.5), TODAY)!;
    expect(t).toMatchObject({ reason: 'long_gap_step_down', loadKg: 20 });
  });

  it('the learned step is used when adding load', () => {
    const history = [x('2026-09-20', 16, sets(4, 15)), x('2026-09-27', 17.5, sets(4, 15))];
    const t = nextTarget(history, config('isolation', 2), TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('19 kg · 4×10');
  });
});

describe('confirm mode (after a failed load jump)', () => {
  // 12.5 kg 4×15 → 13.75 kg 9,8,8,7 (failed) → back to 12.5 kg.
  const failed = [x('2026-09-13', 12.5, sets(4, 15)), x('2026-09-20', 13.75, [9, 8, 8, 7])];

  it('turns on after the failed jump', () => {
    expect(learnProfile(failed, curl).confirmMode).toBe(true);
  });

  it('one time at the top is not enough: repeat the top', () => {
    const t = nextTarget([...failed, x('2026-09-27', 12.5, sets(4, 15))], curl, TODAY)!;
    expect(t).toMatchObject({ reason: 'confirm_top', loadKg: 12.5, reps: sets(4, 15) });
  });

  it('the first time at the top needs the previous exposure at the top too, at the same load', () => {
    const notAtTop = [...failed, x('2026-09-24', 12.5, sets(4, 14)), x('2026-09-27', 12.5, sets(4, 15))];
    expect(nextTarget(notAtTop, curl, TODAY)!.reason).toBe('confirm_top');
    const otherLoad = [...failed, x('2026-09-24', 12.5, sets(4, 15)), x('2026-09-27', 11.25, sets(4, 15))];
    expect(nextTarget(otherLoad, curl, TODAY)!.reason).toBe('confirm_top');
  });

  it('the confirmation target is the top itself, not what was done above it', () => {
    const t = nextTarget([...failed, x('2026-09-27', 12.5, [16, 15, 15, 15])], curl, TODAY)!;
    expect(t).toMatchObject({ reason: 'confirm_top', reps: sets(4, 15) });
  });

  it('two times in a row at the top → add load', () => {
    const history = [...failed, x('2026-09-24', 12.5, sets(4, 15)), x('2026-09-27', 12.5, sets(4, 15))];
    expect(nextTarget(history, curl, TODAY)!).toMatchObject({ reason: 'add_load', loadKg: 13.75 });
  });

  it('"fácil" at the top skips the confirmation', () => {
    const t = nextTarget([...failed, x('2026-09-27', 12.5, sets(4, 15), true)], curl, TODAY)!;
    expect(t).toMatchObject({ reason: 'add_load', loadKg: 13.75 });
  });

  it('turns off after a successful load jump', () => {
    const history = [
      ...failed,
      x('2026-09-24', 12.5, sets(4, 15)),
      x('2026-09-25', 12.5, sets(4, 15)),
      x('2026-09-27', 13.75, sets(4, 10)),
    ];
    expect(learnProfile(history, curl).confirmMode).toBe(false);
  });

  it('is off without a failed jump', () => {
    const t = nextTarget([x('2026-09-27', 12.5, sets(4, 15))], curl, TODAY)!;
    expect(t.reason).toBe('add_load');
  });
});

describe('fast progress', () => {
  // Calf's wide range (12–20) leaves room to see +2.
  const calf = config('calf', 2); // 12–20

  it('beating the target by ≥ 2 twice in a row → +2 reps per set', () => {
    // 4×12 → target 4×13, did 4×15 (+2) → target 4×16, did 4×18 (+2) → +2 → 4×20.
    const history = [x('2026-09-13', 18, sets(4, 12)), x('2026-09-20', 18, sets(4, 15)), x('2026-09-27', 18, sets(4, 18))];
    expect(learnProfile(history, calf).fastProgress).toBe(true);
    expect(nextTarget(history, calf, TODAY)!.reps).toEqual(sets(4, 20));
  });

  it('beating it once is not enough', () => {
    const history = [x('2026-09-20', 18, sets(4, 12)), x('2026-09-27', 18, sets(4, 15))];
    expect(learnProfile(history, calf).fastProgress).toBe(false);
    expect(nextTarget(history, calf, TODAY)!.reps).toEqual(sets(4, 16));
  });

  it('beating it by only 1 does not count', () => {
    const history = [x('2026-09-13', 18, sets(4, 12)), x('2026-09-20', 18, sets(4, 14)), x('2026-09-27', 18, sets(4, 16))];
    expect(learnProfile(history, calf).fastProgress).toBe(false);
  });

  it('stays on while targets are met, turns off when one is missed', () => {
    const on = [x('2026-09-06', 18, sets(4, 12)), x('2026-09-13', 18, sets(4, 15)), x('2026-09-20', 18, sets(4, 18))];
    // Target after `on` is 4×20: meeting it exactly keeps fast progress.
    expect(learnProfile([...on, x('2026-09-27', 18, sets(4, 20))], calf).fastProgress).toBe(true);
    // Missing it turns it off.
    expect(learnProfile([...on, x('2026-09-27', 18, [20, 19, 18, 18])], calf).fastProgress).toBe(false);
  });

  it('+2 never passes the top', () => {
    const history = [x('2026-09-13', 18, sets(4, 12)), x('2026-09-20', 18, sets(4, 15)), x('2026-09-27', 18, sets(4, 19))];
    expect(nextTarget(history, calf, TODAY)!.reps).toEqual(sets(4, 20));
  });
});

describe('bad days', () => {
  it('one drop at the same load → repeat the target it had', () => {
    // 4×9 → target 4×10; did 4×8 (bad day) → repeat 4×10, not 4×9.
    const t = nextTarget([x('2026-09-20', 24, sets(4, 9)), x('2026-09-27', 24, sets(4, 8))], press, TODAY)!;
    expect(t).toMatchObject({ reason: 'bad_day_repeat', loadKg: 24, reps: sets(4, 10) });
  });

  it('repeats the target even if it was a load increase the user skipped', () => {
    // 24 kg 4×12 (top) → target 26 kg 4×8; stayed at 24 and dropped → still 26 kg 4×8.
    const history = [x('2026-09-20', 24, sets(4, 12)), x('2026-09-27', 24, [12, 12, 11, 10])];
    const t = nextTarget(history, press, TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('26 kg · 4×8');
    expect(t.reason).toBe('bad_day_repeat');
  });

  it('two drops in a row → normal rules from the last one', () => {
    const history = [x('2026-09-13', 24, sets(4, 10)), x('2026-09-20', 24, sets(4, 9)), x('2026-09-27', 24, sets(4, 8))];
    expect(nextTarget(history, press, TODAY)!).toMatchObject({ reason: 'add_rep', reps: sets(4, 9) });
  });

  it('a drop with a different load is not a bad day', () => {
    const history = [x('2026-09-20', 24, sets(4, 9)), x('2026-09-27', 22, sets(4, 8))];
    expect(nextTarget(history, press, TODAY)!.reason).toBe('add_rep');
  });
});

describe('stall → light session → one normal attempt → variant', () => {
  const stalled = weeks(5).slice(0, 4).map((d) => x(d, 24, sets(4, 8))); // 30 aug … 20 sep

  it('first: light session', () => {
    expect(nextTarget(stalled, press, TODAY)!.reason).toBe('stalled_light_session');
  });

  it('after the light session: a normal attempt from the last normal exposure', () => {
    const history = [...stalled, x('2026-09-27', 24, sets(2, 8))];
    const t = nextTarget(history, press, TODAY)!;
    expect(t).toMatchObject({ reason: 'add_rep', loadKg: 24, reps: sets(4, 9) });
  });

  it('the light session does not count as a drop', () => {
    const history = [...stalled, x('2026-09-27', 24, sets(2, 8))];
    expect(learnProfile(history, press).deload).toEqual([false, false, false, false, true]);
  });

  it('attempt still stalled → suggest a variant', () => {
    const history = [...stalled, x('2026-09-24', 24, sets(2, 8)), x('2026-09-27', 24, sets(4, 8))];
    expect(nextTarget(history, press, TODAY)!).toMatchObject({ reason: 'stalled_try_variant', reps: sets(4, 8) });
  });

  it('attempt improved → back to normal progression', () => {
    const history = [...stalled, x('2026-09-24', 24, sets(2, 8)), x('2026-09-27', 24, sets(4, 9))];
    expect(nextTarget(history, press, TODAY)!.reason).toBe('add_rep');
  });

  it('a new light session only once the previous one is out of the stall window', () => {
    const dates = weeks(9);
    const history = [
      ...dates.slice(0, 4).map((d) => x(d, 24, sets(4, 8))),
      x(dates[4], 24, sets(2, 8)), // light
      ...dates.slice(5).map((d) => x(d, 24, sets(4, 8))), // 4 more stalled attempts
    ];
    const p = learnProfile(history, press);
    expect(p.targets.at(-1)!.reason).toBe('stalled_try_variant');
    expect(nextTarget(history, press, TODAY)!.reason).toBe('stalled_light_session');
  });
});

describe('the §7 table still holds with personalization on', () => {
  it('tríceps 25 → 30 → 30 kg · 4×11', () => {
    const history = [x('2026-09-16', 25, sets(3, 10)), x('2026-09-27', 30, sets(4, 10))];
    const t = nextTarget(history, config('isolation', 2.5), TODAY)!;
    expect(formatExposure(t.loadKg, t.reps)).toBe('30 kg · 4×11');
  });
});
