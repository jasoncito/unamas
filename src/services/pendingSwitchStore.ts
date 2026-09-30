import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PendingSwitch } from '@/features/account/switchAccount';

const KEY = 'unamas.pendingAccountSwitch';

/**
 * Where a pending account switch (plan B) survives app restarts. Same storage as the Supabase
 * session itself, which holds the same kind of tokens.
 */
export const pendingSwitchStore = {
  async load(): Promise<PendingSwitch | null> {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingSwitch) : null;
  },
  async save(p: PendingSwitch): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
  },
};
