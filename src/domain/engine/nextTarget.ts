import { compareExposures } from '../compare';
import { daysBetween } from '../dates';
import type { ExerciseConfig, Exposure, IsoDate } from '../types';
import { epley } from './epley';
import { EXTEND_REPS, GAP_REDUCE_DAYS, GAP_REPEAT_DAYS, MAX_E1RM_JUMP, STALL_EXPOSURES } from './params';

/** Why the engine chose a target. The UI turns it into a phrase; the engine never writes copy. */
export type TargetReason =
  | 'long_gap_step_down' // rule 1: > 28 days, drop one step and rebuild from the floor
  | 'gap_repeat' // rule 2: > 14 days, repeat the last exposure
  | 'stalled_light_session' // rule 3: 3 exposures without "up", half the sets, away from failure
  | 'add_load' // rule 5: every set at the effective top
  | 'failed_load_jump' // rule 6: below the floor right after a load increase
  | 'even_out_sets' // rule 7: uneven sets, bring them up to the best one
  | 'add_rep'; // rule 8: +1 rep per set

export interface Target {
  loadKg: number;
  reps: number[];
  reason: TargetReason;
  /** Days since the last exposure. */
  gapDays: number;
  /** Top of the range used for this decision: repTop, or repTop + EXTEND_REPS if the next load is not absorbable. */
  effectiveTop: number;
}

/**
 * Next target for one exercise (docs/PROGRESSION.md §4). Rules are checked in order; the first match wins.
 * `history` is sorted oldest → newest. Returns null for an exercise with no history ("primera vez").
 */
export function nextTarget(history: readonly Exposure[], ex: ExerciseConfig, today: IsoDate): Target | null {
  const last = history.at(-1);
  if (!last) return null;

  const lo = ex.repFloor;
  const gapDays = daysBetween(last.date, today);
  const top = isNextLoadAbsorbable(last.loadKg, ex) ? ex.repTop : ex.repTop + EXTEND_REPS;
  const target = (loadKg: number, reps: number[], reason: TargetReason): Target => ({
    loadKg: roundKg(loadKg),
    reps,
    reason,
    gapDays,
    effectiveTop: top,
  });

  // 1. Very long break.
  if (gapDays > GAP_REDUCE_DAYS) {
    return target(last.loadKg - ex.stepKg, last.reps.map(() => lo), 'long_gap_step_down');
  }
  // 2. Long break.
  if (gapDays > GAP_REPEAT_DAYS) {
    return target(last.loadKg, [...last.reps], 'gap_repeat');
  }
  // 3. Stalled: light session, half the sets, reps a bit lower (never below the floor).
  if (isStalled(history, lo)) {
    const sets = Math.max(2, Math.floor(last.reps.length / 2));
    return target(
      last.loadKg,
      last.reps.map((r) => Math.max(lo, r - 2)).slice(0, sets),
      'stalled_light_session',
    );
  }
  // 4–5. Every set at the effective top → add load, back to the floor.
  const minReps = Math.min(...last.reps);
  if (minReps >= top) {
    return target(last.loadKg + ex.stepKg, last.reps.map(() => lo), 'add_load');
  }
  // 6. Below the floor right after a load increase → back to the previous load, +1 on what was done there.
  const prev = history.at(-2);
  if (minReps < lo && prev && prev.loadKg < last.loadKg) {
    return target(prev.loadKg, prev.reps.map((r) => Math.min(top, r + 1)), 'failed_load_jump');
  }
  // 7. Uneven sets → bring each up to the best set (at most +2 per set).
  const maxReps = Math.max(...last.reps);
  if (minReps !== maxReps) {
    return target(last.loadKg, last.reps.map((r) => Math.min(top, maxReps, r + 2)), 'even_out_sets');
  }
  // 8. +1 rep per set, without passing the effective top.
  return target(last.loadKg, last.reps.map((r) => Math.min(top, r + 1)), 'add_rep');
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

/** Avoids float drift such as 12.5 + 1.25 + 1.25 → 14.999999. */
function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}
