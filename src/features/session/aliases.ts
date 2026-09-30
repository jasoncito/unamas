import type { Db } from '@/data/db';
import { addExerciseAlias, type AddAliasResult } from '@/data/repos/exercises';
import { phraseToAlias } from '@/domain/names';

/**
 * Screen 5: the user tapped which exercise they meant. Their phrase, without numbers, becomes an alias
 * of that exercise, so next time the same words resolve straight to it (CLAUDE.md §6). Only for
 * "which exercise?" questions, not for "how much weight?".
 */
export async function learnAliasFromChoice(
  db: Db,
  rawText: string,
  chosenExerciseId: string,
): Promise<AddAliasResult | 'nothing_to_learn'> {
  const alias = phraseToAlias(rawText);
  return alias ? addExerciseAlias(db, chosenExerciseId, alias) : 'nothing_to_learn';
}
