import { compareExposures } from '../compare';
import { daysBetween } from '../dates';
import type { ExerciseConfig, Exposure, IsoDate } from '../types';
import { epley } from './epley';
import { EXTEND_REPS, GAP_REDUCE_DAYS, GAP_REPEAT_DAYS, MAX_E1RM_JUMP, STALL_EXPOSURES } from './params';
import type { Target, TargetReason } from './target';

/** Exercise config as learned from the history (PROGRESSION.md §6.1). */
export interface Profile extends ExerciseConfig {
  confirmMode: boolean;
  fastProgress: boolean;
  /** Per exposure: it was done under a light-session target. */
  deload: boolean[];
  /** Per exposure: the target that was in effect when it was done (null for the first one). */
  targets: (Target | null)[];
}

/**
 * Rules of PROGRESSION.md §4 plus the §6 personalization, in order; the first match wins.
 * `history` is sorted oldest → newest, non-empty, and `profile` was learned from it.
 */
export function decide(history: readonly Exposure[], profile: Profile, today: IsoDate): Target {
  const lo = profile.repFloor;
  const gapDays = daysBetween(history.at(-1)!.date, today);

  // Light sessions don't count: the rules below look only at normal exposures.
  const normalIdx = history.map((_, i) => i).filter((i) => !profile.deload[i]);
  const normal = normalIdx.map((i) => history[i]);
  const last = normal.at(-1)!;
  const prev = normal.at(-2);

  const top = isNextLoadAbsorbable(last.loadKg, profile) ? profile.repTop : profile.repTop + EXTEND_REPS;
  const target = (loadKg: number, reps: number[], reason: TargetReason): Target => ({
    loadKg: roundKg(loadKg),
    reps,
    reason,
    gapDays,
    effectiveTop: top,
  });

  // 1. Very long break.
  if (gapDays > GAP_REDUCE_DAYS) {
    return target(last.loadKg - profile.stepKg, last.reps.map(() => lo), 'long_gap_step_down');
  }
  // 2. Long break.
  if (gapDays > GAP_REPEAT_DAYS) {
    return target(last.loadKg, [...last.reps], 'gap_repeat');
  }
  // 3. Stalled: light session first; after it, one normal attempt; if still stalled, suggest a variant.
  if (isStalled(normal, lo)) {
    const windowStart = normalIdx[normalIdx.length - (STALL_EXPOSURES + 1)];
    const lightSessionInWindow = profile.deload.lastIndexOf(true) > windowStart;
    const justDidLightSession = profile.deload[history.length - 1];
    if (!lightSessionInWindow) {
      const sets = Math.max(2, Math.floor(last.reps.length / 2));
      return target(
        last.loadKg,
        last.reps.map((r) => Math.max(lo, r - 2)).slice(0, sets),
        'stalled_light_session',
      );
    }
    if (!justDidLightSession) {
      return target(last.loadKg, [...last.reps], 'stalled_try_variant');
    }
  }
  // §6 Bad day: dropped once at the same load → repeat the target it had. Twice → normal rules.
  const inEffect = profile.targets[normalIdx.at(-1)!];
  const prev2 = normal.at(-3);
  if (
    prev &&
    droppedAtSameLoad(prev, last, lo) &&
    !(prev2 && droppedAtSameLoad(prev2, prev, lo)) &&
    inEffect
  ) {
    return target(inEffect.loadKg, [...inEffect.reps], 'bad_day_repeat');
  }
  // 4–5. Every set at the effective top → add load, back to the floor (unless §6 holds it).
  const minReps = Math.min(...last.reps);
  if (minReps >= top) {
    if (last.effort === 'failure') {
      return target(last.loadKg, [...last.reps], 'hold_after_failure');
    }
    const confirmed =
      !profile.confirmMode ||
      last.effort === 'easy' ||
      (prev !== undefined && prev.loadKg === last.loadKg && Math.min(...prev.reps) >= top);
    if (!confirmed) {
      return target(last.loadKg, last.reps.map(() => top), 'confirm_top');
    }
    return target(last.loadKg + profile.stepKg, last.reps.map(() => lo), 'add_load');
  }
  // 6. Below the floor right after a load increase → back to the previous load, +1 on what was done there.
  if (minReps < lo && prev && prev.loadKg < last.loadKg) {
    return target(prev.loadKg, prev.reps.map((r) => Math.min(top, r + 1)), 'failed_load_jump');
  }
  // 7. Uneven sets → bring each up to the best set (at most +2 per set).
  const maxReps = Math.max(...last.reps);
  if (minReps !== maxReps) {
    return target(last.loadKg, last.reps.map((r) => Math.min(top, maxReps, r + 2)), 'even_out_sets');
  }
  // 8. +1 rep per set (+2 with fast progress), without passing the effective top.
  const inc = profile.fastProgress ? 2 : 1;
  return target(last.loadKg, last.reps.map((r) => Math.min(top, r + inc)), 'add_rep');
}

/**
 * §3.3: the next load is absorbable if its estimated 1RM at the floor is at most MAX_E1RM_JUMP
 * above the current load's estimated 1RM at the top.
 */
export function isNextLoadAbsorbable(loadKg: number, ex: ExerciseConfig): boolean {
  return epley(loadKg + ex.stepKg, ex.repFloor) <= epley(loadKg, ex.repTop) * (1 + MAX_E1RM_JUMP);
}

/** STALL_EXPOSURES consecutive comparisons without "up". */
export function isStalled(history: readonly Exposure[], repFloor: number): boolean {
  const recent = history.slice(-(STALL_EXPOSURES + 1));
  if (recent.length < STALL_EXPOSURES + 1) return false;
  return recent.slice(1).every((cur, i) => compareExposures(recent[i], cur, repFloor) !== 'up');
}

function droppedAtSameLoad(prev: Exposure, cur: Exposure, repFloor: number): boolean {
  return cur.loadKg === prev.loadKg && compareExposures(prev, cur, repFloor) === 'down';
}

/** Avoids float drift such as 5.1 + 1.1 → 6.199999. */
export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}
