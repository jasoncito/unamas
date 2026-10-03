import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { formatClock } from '@/domain/format';

import { font, tabular } from '../text';
import { color } from '../tokens';
import { StopButton } from './StopButton';

interface Props {
  groupsLabel: string;
  /** When EMPEZAR was tapped: the stopwatch counts from there. */
  startedAt: string;
  flood: SharedValue<number>;
  onEnd(): void;
  stopTip?: number;
  /** No entries yet: no stop (nothing to end) and a visible way back, "‹". */
  showStop: boolean;
  onBack?(): void;
}

/**
 * Screen 6's bar, from EMPEZAR (backlog: gym test): the groups and the stopwatch; the stop from the
 * first entry. Before it, "‹" in front of the groups goes back to screen 1.
 */
export function SessionBar({ groupsLabel, startedAt, flood, onEnd, stopTip, showStop, onBack }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={styles.bar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={styles.groupsBox} accessibilityRole="button">
          <Text style={styles.groups} numberOfLines={1}>
            <Text style={styles.chevron}>‹ </Text>
            {groupsLabel}
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.groups, styles.groupsBox]} numberOfLines={1}>
          {groupsLabel}
        </Text>
      )}
      <Text style={styles.clock}>{formatClock(now - Date.parse(startedAt))}</Text>
      {showStop ? <StopButton flood={flood} onComplete={onEnd} tipSignal={stopTip} /> : <View style={styles.stopSpace} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, zIndex: 10 },
  groupsBox: { flex: 1 },
  groups: { ...font('title'), color: color.text },
  chevron: { color: color.muted },
  // Keeps the bar's height before the stop appears.
  stopSpace: { height: 52 },
  clock: { fontSize: 17, fontWeight: '700', letterSpacing: 17 * -0.01, color: color.text, ...tabular },
});
