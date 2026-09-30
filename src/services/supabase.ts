import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Supabase client (MULTIUSER.md §2). The publishable key can ship in the app: RLS is what protects
 * the data. Null when the env vars are missing, so the app still works fully offline in development.
 */
export const supabase =
  url && publishableKey
    ? createClient(url, publishableKey, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;
