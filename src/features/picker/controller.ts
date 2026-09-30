import type { Db } from '@/data/db';
import { getLastTrainedByGroup } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';

import { orderMuscleGroups, type MuscleGroupRow } from './groups';

/** Screen 1 data: every muscle group with the local date it was last trained, in display order. */
export async function loadMuscleGroups(db: Db, userId: string): Promise<MuscleGroupRow[]> {
  const lastAt = await getLastTrainedByGroup(db, userId);
  const lastDates = new Map([...lastAt].map(([group, iso]) => [group, localDateOf(iso)]));
  return orderMuscleGroups(lastDates);
}
