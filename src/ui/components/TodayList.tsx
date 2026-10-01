import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { shortDelta } from '@/domain/delta';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { PendingLine, TodayLine } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, space } from '../tokens';
import { CheckDot } from './CheckDot';

type Row = { kind: 'logged'; line: TodayLine } | { kind: 'pending'; line: PendingLine };

/**
 * Screen 4's "Hoy": each logged exercise with today's set and its delta vs. its own last time, and
 * in gray what was saved without signal and isn't understood yet, so it isn't logged twice.
 */
export function TodayList({ lines, pending }: { lines: readonly TodayLine[]; pending: readonly PendingLine[] }) {
  const rows: Row[] = [
    ...lines.map((line) => ({ kind: 'logged' as const, line })),
    ...pending.map((line) => ({ kind: 'pending' as const, line })),
  ].sort((a, b) => a.line.createdAt.localeCompare(b.line.createdAt));

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{copy.session.today}</Text>
      {rows.map((r, i) => (
        <Animated.View key={r.line.entryId} entering={FadeIn.duration(300)} style={[styles.row, i < rows.length - 1 && styles.divider]}>
          {r.kind === 'logged' ? <LoggedRow line={r.line} /> : <PendingRow line={r.line} />}
        </Animated.View>
      ))}
    </View>
  );
}

function LoggedRow({ line: l }: { line: TodayLine }) {
  return (
    <>
      <CheckDot />
      <View style={styles.body}>
        <Text style={styles.name}>{l.name}</Text>
        <Text style={styles.sub}>{l.comparedTo ? `${copy.session.vs} ${formatShortDate(l.comparedTo)}` : copy.session.firstTime}</Text>
      </View>
      <Text style={styles.value}>
        {`${formatLoad(l.loadKg, l.loadBasis)} · ${formatSets(l.reps)}`}
        <Text style={[styles.delta, l.delta.kind !== 'new' && l.delta.tone === 'up' && styles.up]}>{`  ${shortDelta(l.delta)}`}</Text>
      </Text>
    </>
  );
}

/** Their words as they said them, with the empty circle of what isn't done yet. */
function PendingRow({ line }: { line: PendingLine }) {
  return (
    <>
      <View style={styles.emptyDot} />
      <Text style={[styles.name, styles.muted, styles.body]} numberOfLines={2}>
        {line.rawText}
      </Text>
      <Text style={styles.pending}>{copy.session.pending}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  label: { ...font('label'), color: color.muted, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: space.rowY },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  body: { flex: 1 },
  name: { ...font('row'), color: color.text },
  muted: { color: color.muted },
  sub: { fontSize: 12, fontWeight: '500', color: color.muted, marginTop: 2 },
  value: { fontSize: 15, fontWeight: '600', color: color.text, ...tabular },
  delta: { fontSize: 12, fontWeight: '700', color: color.muted },
  up: { color: color.green },
  emptyDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: color.border },
  pending: { fontSize: 12, fontWeight: '600', color: color.muted },
});
