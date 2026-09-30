import type { Db } from '@/data/db';
import { newId } from '@/data/ids';
import { createSession, getLastTrainedByGroup } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';

import { orderMuscleGroups, type MuscleGroupRow } from './groups';

/** Screen 1 data: every muscle group with the local date it was last trained, in display order. */
export async function loadMuscleGroups(db: Db): Promise<MuscleGroupRow[]> {
  const lastAt = await getLastTrainedByGroup(db);
  const lastDates = new Map([...lastAt].map(([group, iso]) => [group, localDateOf(iso)]));
  return orderMuscleGroups(lastDates);
}

/** EMPEZAR: opens a session for the chosen groups, in the order they were tapped. Returns its id. */
export async function startSession(db: Db, groups: readonly string[]): Promise<string> {
  const id = newId();
  await createSession(db, id, groups);
  return id;
}
