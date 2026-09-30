import { epley } from './engine/epley';
import { COMPARE_TOLERANCE } from './engine/params';
import type { Exposure } from './types';

export type Comparison = 'up' | 'same' | 'down';

/**
 * "subió / igual / bajó" for the summary (docs/PROGRESSION.md §5).
 * Each exercise is compared against its own previous exposure.
 */
export function compareExposures(prev: Exposure, cur: Exposure, repFloor: number): Comparison {
  if (cur.loadKg > prev.loadKg && Math.min(...cur.reps) >= repFloor) return 'up';

  if (cur.loadKg === prev.loadKg) {
    const diff = sum(cur.reps) - sum(prev.reps);
    return diff > 0 ? 'up' : diff === 0 ? 'same' : 'down';
  }

  // Load went down, or went up but fell below the floor: compare best sets by estimated 1RM.
  const a = bestE1rm(cur);
  const b = bestE1rm(prev);
  if (a > b * (1 + COMPARE_TOLERANCE)) return 'up';
  return a >= b * (1 - COMPARE_TOLERANCE) ? 'same' : 'down';
}

function bestE1rm(e: Exposure): number {
  return Math.max(...e.reps.map((r) => epley(e.loadKg, r)));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
