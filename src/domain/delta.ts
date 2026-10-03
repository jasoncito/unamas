import { compareExposures, type Comparison } from './compare';
import type { Exposure } from './types';

/** How today's entry differs from that exercise's last one (screen 4 feedback, screen 7 summary). */
export type Delta =
  | { kind: 'new' }
  | { kind: 'load'; diffKg: number; tone: Comparison }
  | { kind: 'reps_per_set'; diff: number; tone: Comparison }
  | { kind: 'reps_total'; diff: number; tone: Comparison }
  /** A different number of sets: how many, and the reps per set when both times had even sets. */
  | { kind: 'sets'; setsDiff: number; repsDiff: number | null; tone: Comparison }
  | { kind: 'same'; tone: Comparison };

/**
 * Compared with the exercise's own last entry, wherever it was (PROGRESSION.md §5). The tone (up / same /
 * down) is §5's comparison; the kind says what changed, to put it in words.
 */
export function deltaOf(previous: Exposure | null, today: Exposure, repFloor: number): Delta {
  if (!previous) return { kind: 'new' };
  const tone = compareExposures(previous, today, repFloor);
  if (today.loadKg !== previous.loadKg) return { kind: 'load', diffKg: round(today.loadKg - previous.loadKg), tone };

  // Sets and reps changed at once (4×17 → 3×20): say both, never a lone total ("−4" said nothing).
  if (today.reps.length !== previous.reps.length) {
    const even = (r: readonly number[]) => r.every((x) => x === r[0]);
    const repsDiff = even(today.reps) && even(previous.reps) ? today.reps[0] - previous.reps[0] : null;
    return { kind: 'sets', setsDiff: today.reps.length - previous.reps.length, repsDiff, tone };
  }
  const perSet = today.reps.map((r, i) => r - previous.reps[i]);
  if (today.reps.length === previous.reps.length && perSet.every((d) => d === perSet[0]) && perSet[0] !== 0) {
    return { kind: 'reps_per_set', diff: perSet[0], tone };
  }
  const total = sum(today.reps) - sum(previous.reps);
  return total === 0 ? { kind: 'same', tone } : { kind: 'reps_total', diff: total, tone };
}

/** The short form at the end of a row: "+1", "−1", "+2 kg", "=", "nuevo", "−1 serie · +3 reps". */
export function shortDelta(d: Delta): string {
  switch (d.kind) {
    case 'new':
      return 'nuevo';
    case 'same':
      return '=';
    case 'load':
      return `${signed(d.diffKg)} kg`;
    case 'reps_per_set':
    case 'reps_total':
      return signed(d.diff);
    case 'sets':
      return setsChange(d.setsDiff, d.repsDiff);
  }
}

/** "−1 serie · +3 reps", "+1 serie" (reps unchanged or uneven). */
export function setsChange(setsDiff: number, repsDiff: number | null): string {
  const sets = `${signed(setsDiff)} ${Math.abs(setsDiff) === 1 ? 'serie' : 'series'}`;
  return repsDiff ? `${sets} · ${signed(repsDiff)} ${Math.abs(repsDiff) === 1 ? 'rep' : 'reps'}` : sets;
}

/** "+2", "−1" (a real minus sign), "+2.5". */
export function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function round(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}
