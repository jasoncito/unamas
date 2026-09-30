import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { useUserId } from '@/services/auth';

import { loadMuscleGroups } from './controller';
import type { MuscleGroupRow } from './groups';

export function useMuscleGroups(): MuscleGroupRow[] | null {
  const db = useSQLiteContext();
  const userId = useUserId();
  const [groups, setGroups] = useState<MuscleGroupRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMuscleGroups(db, userId).then((g) => !cancelled && setGroups(g));
    return () => {
      cancelled = true;
    };
  }, [db, userId]);
  return groups;
}
