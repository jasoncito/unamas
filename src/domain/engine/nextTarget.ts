import type { ExerciseConfig, Exposure, IsoDate } from '../types';
import { learnProfile } from './profile';
import { decide } from './rules';
import type { Target } from './target';

/**
 * Next target for one exercise (docs/PROGRESSION.md §4 and §6).
 * `history` is sorted oldest → newest. Returns null for an exercise with no history ("primera vez").
 */
export function nextTarget(history: readonly Exposure[], ex: ExerciseConfig, today: IsoDate): Target | null {
  if (history.length === 0) return null;
  return decide(history, learnProfile(history, ex), today);
}
