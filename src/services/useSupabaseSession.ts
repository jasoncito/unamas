import { useEffect } from 'react';
import { AppState } from 'react-native';

import { ensureSession } from './auth';
import { supabase } from './supabase';

/**
 * Keeps the Supabase session alive while the app is in the foreground: ensures one exists on launch
 * and every time the app comes back (the retry for a first launch without signal), and only
 * refreshes tokens while active. Never blocks the UI.
 */
export function useSupabaseSession(): void {
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    void ensureSession(client.auth);
    client.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        client.auth.startAutoRefresh();
        void ensureSession(client.auth);
      } else {
        client.auth.stopAutoRefresh();
      }
    });
    return () => sub.remove();
  }, []);
}
