import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Settings } from 'react-native';

/** Development screens are on: in development, or in a build made with EXPO_PUBLIC_DEV_SCREENS=1. */
export const DEV_SCREENS = __DEV__ || process.env.EXPO_PUBLIC_DEV_SCREENS === '1';

/**
 * Screenshots: `xcrun simctl launch <sim> com.jasoncito.unamas -devScreen bar:subido` opens the weight
 * selector's development screen right away (a link from outside would stop at iOS's "Open in…?").
 */
export function useDevLaunch(): void {
  useEffect(() => {
    if (!DEV_SCREENS || Platform.OS !== 'ios') return;
    const arg = Settings.get('devScreen');
    if (typeof arg !== 'string' || !arg) return;
    const [ex, state] = arg.split(':');
    router.replace({ pathname: '/dev/weight-selector', params: { ex, state } });
  }, []);
}
