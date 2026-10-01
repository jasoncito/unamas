import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { formatClock } from '@/domain/format';

import { font, tabular } from '../text';
import { color } from '../tokens';
import { StopButton } from './StopButton';

interface Props {
  groupsLabel: string;
  /** ISO timestamp of the first entry: the stopwatch counts from there. */
  startedAt: string;
  flood: SharedValue<number>;
  onEnd(): void;
  stopTip?: number;
}

/** Screen 6's bar, from the first entry: the groups, the stopwatch and the stop. */
export function SessionBar({ groupsLabel, startedAt, flood, onEnd, stopTip }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={styles.bar}>
      <Text style={styles.groups} numberOfLines={1}>
        {groupsLabel}
      </Text>
      <Text style={styles.clock}>{formatClock(now - Date.parse(startedAt))}</Text>
      <StopButton flood={flood} onComplete={onEnd} tipSignal={stopTip} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, zIndex: 10 },
  groups: { ...font('title'), color: color.text, flex: 1 },
  clock: { fontSize: 17, fontWeight: '700', letterSpacing: 17 * -0.01, color: color.text, ...tabular },
});
