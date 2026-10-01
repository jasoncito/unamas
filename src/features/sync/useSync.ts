import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { sync } from '@/data/sync';
import { ensureSession } from '@/services/auth';
import { onReconnectOrForeground } from '@/services/network';
import { pendingSwitchStore } from '@/services/pendingSwitchStore';
import { supabase } from '@/services/supabase';
import { supabaseRemote } from '@/services/supabaseRemote';

import { createSyncScheduler, type SyncScheduler } from './scheduler';

let current: SyncScheduler | null = null;

/** Ask for a sync a few seconds from now (after saving an entry). No-op without Supabase. */
export function requestSync(): void {
  current?.soon();
}

/**
 * Runs sync on launch, when the app comes back to the foreground and when the network returns
 * (MULTIUSER.md §4). Needs a session: without one (first launch offline) it tries to create the
 * anonymous account first, and if that fails too, waits for the next trigger.
 */
export function useSync(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const remote = supabaseRemote(client);
    const scheduler = createSyncScheduler(
      async () => {
        if (!(await ensureSession(client.auth))) return;
        await sync(db, remote, { canUpload: async () => (await pendingSwitchStore.load()) === null });
      },
      { onError: (e) => __DEV__ && console.log('[sync]', e) },
    );
    current = scheduler;
    void scheduler.now();

    const stopWatching = onReconnectOrForeground(() => void scheduler.now());

    return () => {
      stopWatching();
      scheduler.dispose();
      if (current === scheduler) current = null;
    };
  }, [db]);
}
