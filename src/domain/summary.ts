import { deltaOf, type Delta } from './delta';
import type { Target } from './engine';
import type { ExerciseConfig, Exposure, LoadBasis } from './types';

/** One exercise of the session, as the summary needs it (screen 7). */
export interface SummaryItem {
  exerciseId: string;
  name: string;
  loadBasis: LoadBasis;
  config: ExerciseConfig;
  /** Its last entry before this session, wherever it was (PROGRESSION.md §5). Null the first time. */
  previous: Exposure | null;
  /** Its last entry of this session. */
  today: Exposure;
  /** What the engine says for next time, from the whole history including today. */
  target: Target | null;
}

export type Verdict = 'up' | 'same' | 'down' | 'new';

export interface SummaryRow extends SummaryItem {
  verdict: Verdict;
  delta: Delta;
}

export interface Tally {
  up: number;
  same: number;
  down: number;
  new: number;
}

/** Every exercise against its own last time, and how many went up, stayed, went down or are new. */
export function summarize(items: readonly SummaryItem[]): { rows: SummaryRow[]; tally: Tally } {
  const tally: Tally = { up: 0, same: 0, down: 0, new: 0 };
  const rows = items.map((item) => {
    const delta = deltaOf(item.previous, item.today, item.config.repFloor);
    const verdict: Verdict = delta.kind === 'new' ? 'new' : delta.tone;
    tally[verdict]++;
    return { ...item, delta, verdict };
  });
  return { rows, tally };
}

/** Targets worth telling about at the end, most relevant first (CLAUDE.md §8, screen 7). */
const NEXT_TIME_PRIORITY = ['add_load', 'failed_load_jump', 'bad_day_repeat'] as const;
export type NextTimeReason = (typeof NEXT_TIME_PRIORITY)[number];

/**
 * "La próxima vez": the most relevant target of the session — a load increase first, then going
 * back after a failed jump, then repeating after a bad day; in the order they were logged. Null if
 * every exercise just adds a rep (nothing worth singling out).
 */
export function pickNextTime(items: readonly SummaryItem[]): (SummaryItem & { target: Target & { reason: NextTimeReason } }) | null {
  for (const reason of NEXT_TIME_PRIORITY) {
    const found = items.find((i) => i.target?.reason === reason);
    if (found) return found as SummaryItem & { target: Target & { reason: NextTimeReason } };
  }
  return null;
}
