import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { loadMuscleGroups } from './controller';
import type { MuscleGroupRow } from './groups';

export function useMuscleGroups(): MuscleGroupRow[] | null {
  const db = useSQLiteContext();
  const [groups, setGroups] = useState<MuscleGroupRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMuscleGroups(db).then((g) => !cancelled && setGroups(g));
    return () => {
      cancelled = true;
    };
  }, [db]);
  return groups;
}
