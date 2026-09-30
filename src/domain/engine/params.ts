import type { ExerciseKind } from '../types';

// Parameters from docs/PROGRESSION.md §3. Tags there say which are [evidencia] and which are [heurística].

/** Initial rep range per exercise kind, [floor, top]. */
export const REP_RANGES: Record<ExerciseKind, readonly [number, number]> = {
  compound_heavy: [6, 10],
  compound: [8, 12],
  isolation: [10, 15],
  calf: [12, 20],
};

/** New (load + step, floor) may exceed current (load, top) estimated 1RM by at most this fraction. */
export const MAX_E1RM_JUMP = 0.05;
/** If the next load is not absorbable, the top of the range is extended by this many reps. */
export const EXTEND_REPS = 5;
/** Consecutive exposures without "up" that count as a stall. */
export const STALL_EXPOSURES = 3;
/** More days than this since the last exposure → repeat it. */
export const GAP_REPEAT_DAYS = 14;
/** More days than this since the last exposure → drop one step. */
export const GAP_REDUCE_DAYS = 28;
/** Epley band within which two exposures count as "same". */
export const COMPARE_TOLERANCE = 0.01;
