import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { Platform, Settings } from 'react-native';

import { prepareCapture, settleFlowCapture } from './flowCapture';

/** Development screens are on: in development, or in a build made with EXPO_PUBLIC_DEV_SCREENS=1. */
export const DEV_SCREENS = __DEV__ || process.env.EXPO_PUBLIC_DEV_SCREENS === '1';

/** How long the session screen takes to load and reopen its draft before a flow capture settles. */
const SETTLE_MS = 2500;

/**
 * Screenshots: `xcrun simctl launch <sim> com.jasoncito.unamas -devScreen bar:subido` opens the weight
 * selector's development screen right away (a link from outside would stop at iOS's "Open in…?").
 * `flujo:lista|entrenando|reps` and `historial:musculo|sesion|ejercicio` open the per-exercise flow and
 * the history in that state (src/features/dev/flowCapture.ts).
 */
/** The launch argument, if this is a development launch for a screenshot. */
export function devScreenArg(): string | null {
  if (!DEV_SCREENS || Platform.OS !== 'ios') return null;
  const arg = Settings.get('devScreen');
  return typeof arg === 'string' && arg ? arg : null;
}

export function useDevLaunch(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    const arg = devScreenArg();
    if (!arg) return;
    const [screen, state] = arg.split(':');
    if (screen !== 'flujo' && screen !== 'historial') {
      router.replace({ pathname: '/dev/weight-selector', params: { ex: screen, state } });
      return;
    }
    void prepareCapture(db, screen, state).then((href) => {
      if (!href) return;
      router.replace(href);
      // Not cleared on unmount: this screen goes away with the replace, and the timer must outlive it.
      if (screen === 'flujo') setTimeout(() => void settleFlowCapture(db, state), SETTLE_MS);
    });
  }, [db]);
}
