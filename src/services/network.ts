import NetInfo, { useNetInfo } from '@react-native-community/netinfo';
import { AppState } from 'react-native';

/**
 * Calls `onChance` whenever there's a new chance to reach the network: the app comes back to the
 * foreground, or the signal returns after being lost. Returns the unsubscribe.
 */
export function onReconnectOrForeground(onChance: () => void): () => void {
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') onChance();
  });
  let online: boolean | null = null;
  const unsubscribeNet = NetInfo.addEventListener(({ isConnected }) => {
    if (isConnected && online === false) onChance();
    online = isConnected;
  });
  return () => {
    appState.remove();
    unsubscribeNet();
  };
}

/** False only when the phone knows it has no connection (unknown counts as online). */
export function useIsOnline(): boolean {
  return useNetInfo().isConnected !== false;
}
