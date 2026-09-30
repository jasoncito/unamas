import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { initDb } from '@/data/init';
import type { Seed } from '@/data/seed';
import { PROVISIONAL_USER_ID } from '@/services/auth';
import { color } from '@/ui/tokens';

// Development history (dev/seed.json), loaded into an empty database with EXPO_PUBLIC_SEED=1.
const seed: Seed | null = process.env.EXPO_PUBLIC_SEED === '1' ? require('../dev/seed.json') : null;

// TODO(M2b): seed for the Supabase user once the session exists.
const onInit = (db: SQLiteDatabase) => initDb(db, seed, PROVISIONAL_USER_ID);

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="unamas.db" onInit={onInit}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
    </SQLiteProvider>
  );
}
