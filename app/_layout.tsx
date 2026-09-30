import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { initDb } from '@/data/init';
import type { Seed } from '@/data/seed';
import { useSync } from '@/features/sync/useSync';
import { useSupabaseSession } from '@/services/useSupabaseSession';
import { color } from '@/ui/tokens';

// Development history (dev/seed.json), loaded into an empty database with EXPO_PUBLIC_SEED=1.
const seed: Seed | null = process.env.EXPO_PUBLIC_SEED === '1' ? require('../dev/seed.json') : null;

const onInit = (db: SQLiteDatabase) => initDb(db, seed);

export default function RootLayout() {
  useSupabaseSession();

  return (
    <SQLiteProvider databaseName="unamas.db" onInit={onInit}>
      <SyncRunner />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
    </SQLiteProvider>
  );
}

/** Lives inside SQLiteProvider so sync can reach the database. Renders nothing. */
function SyncRunner() {
  useSync();
  return null;
}
