import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { shortDelta } from '@/domain/delta';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { TodayLine } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, space } from '../tokens';
import { CheckDot } from './CheckDot';

/** Screen 4's "Hoy": each logged exercise with today's set and its delta vs. its own last time. */
export function TodayList({ lines }: { lines: readonly TodayLine[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{copy.session.today}</Text>
      {lines.map((l, i) => (
        <Animated.View key={l.entryId} entering={FadeIn.duration(300)} style={[styles.row, i < lines.length - 1 && styles.divider]}>
          <CheckDot />
          <View style={styles.body}>
            <Text style={styles.name}>{l.name}</Text>
            <Text style={styles.vs}>{l.comparedTo ? `${copy.session.vs} ${formatShortDate(l.comparedTo)}` : copy.session.firstTime}</Text>
          </View>
          <Text style={styles.value}>
            {`${formatLoad(l.loadKg, l.loadBasis)} · ${formatSets(l.reps)}`}
            <Text style={[styles.delta, l.delta.kind !== 'new' && l.delta.tone === 'up' && styles.up]}>{`  ${shortDelta(l.delta)}`}</Text>
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  label: { ...font('label'), color: color.muted, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: space.rowY },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  body: { flex: 1 },
  name: { ...font('row'), color: color.text },
  vs: { fontSize: 12, fontWeight: '500', color: color.muted, marginTop: 2 },
  value: { fontSize: 15, fontWeight: '600', color: color.text, ...tabular },
  delta: { fontSize: 12, fontWeight: '700', color: color.muted },
  up: { color: color.green },
});
