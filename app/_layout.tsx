import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { initDb } from '@/data/init';
import type { Seed } from '@/data/seed';
import { usePastSessionsRetry } from '@/features/session/pastSessions';
import { useSync } from '@/features/sync/useSync';
import { useSupabaseSession } from '@/services/useSupabaseSession';
import { color } from '@/ui/tokens';

// Development history (dev/seed.json), loaded into an empty database with EXPO_PUBLIC_SEED=1.
const seed: Seed | null = process.env.EXPO_PUBLIC_SEED === '1' ? require('../dev/seed.json') : null;

const onInit = (db: SQLiteDatabase) => initDb(db, seed);

export default function RootLayout() {
  useSupabaseSession();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SQLiteProvider databaseName="unamas.db" onInit={onInit}>
        <SyncRunner />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
      </SQLiteProvider>
    </GestureHandlerRootView>
  );
}

/** Lives inside SQLiteProvider so sync and the retries of stopped sessions reach the database. Renders nothing. */
function SyncRunner() {
  useSync();
  usePastSessionsRetry();
  return null;
}
