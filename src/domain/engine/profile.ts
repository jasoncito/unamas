import type { ExerciseConfig, Exposure } from '../types';
import { decide, roundKg, type Profile } from './rules';

/**
 * Walks the history oldest → newest, working out the target each exposure had at the time
 * and adjusting the exercise to the person (PROGRESSION.md §6.1). Nothing is stored:
 * the profile is always rebuilt from the history.
 */
export function learnProfile(history: readonly Exposure[], ex: ExerciseConfig): Profile {
  const p: Profile = { ...ex, confirmMode: false, fastProgress: false, deload: [], targets: [] };
  let exceededPrevious = false;

  history.forEach((cur, i) => {
    const prev = history[i - 1];
    const t = prev ? decide(history.slice(0, i), p, cur.date) : null;
    p.targets.push(t);
    p.deload.push(t?.reason === 'stalled_light_session');

    // Rep range: recentered once, from the first 2 exposures.
    if (i === 1) {
      const range = recenteredRange([...prev.reps, ...cur.reps], ex.repFloor, ex.repTop);
      if (range) [p.repFloor, p.repTop] = range;
    }

    // Step and confirm mode: learned from load increases.
    if (prev && cur.loadKg > prev.loadKg) {
      p.stepKg = roundKg(cur.loadKg - prev.loadKg);
      p.confirmMode = Math.min(...cur.reps) < p.repFloor;
    }

    // Fast progress: beat the target by ≥ 2 reps per set twice in a row; off when a target is missed.
    const atTargetLoad = t !== null && cur.loadKg === t.loadKg;
    const beatBy = (n: number) => atTargetLoad && t.reps.every((r, k) => cur.reps[k] >= r + n);
    const exceeded = beatBy(2);
    p.fastProgress = p.fastProgress ? !atTargetLoad || beatBy(0) : exceeded && exceededPrevious;
    exceededPrevious = exceeded;
  });

  return p;
}

/** [median − 2, median + 3] when every set is out of range on the same side; otherwise null. */
function recenteredRange(reps: number[], floor: number, top: number): [number, number] | null {
  const allAbove = reps.every((r) => r > top);
  const allBelow = reps.every((r) => r < floor);
  if (!allAbove && !allBelow) return null;
  const m = median(reps);
  return [Math.max(1, m - 2), m + 3];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
