import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { endStaleSessions, getOpenSession } from '@/data/repos/sessions';
import { devScreenArg } from '@/features/dev/useDevLaunch';

/** On launch, a session left open goes straight to /session (CLAUDE.md §4.2). */
export function useOpenSessionRedirect(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    // A screenshot of the history: the development launch decides where to go (src/features/dev/flowCapture.ts).
    if (devScreenArg()?.startsWith('historial:')) return;
    // A session forgotten open (no stop for hours) is closed first, so the app starts on screen 1.
    endStaleSessions(db, new Date().toISOString())
      .then(() => getOpenSession(db))
      .then((s) => s && router.replace('/session'));
  }, [db]);
}
