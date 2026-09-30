import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { getOpenSession } from '@/data/repos/sessions';

/** On launch, a session left open goes straight to /session (CLAUDE.md §4.2). */
export function useOpenSessionRedirect(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    getOpenSession(db).then((s) => s && router.replace('/session'));
  }, [db]);
}
