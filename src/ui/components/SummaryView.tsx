import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { shortDelta } from '@/domain/delta';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { SummaryRow } from '@/domain/summary';
import type { SessionSummary } from '@/features/session/controller';
import { nextTimeLine, pendingLine, tallyLines } from '@/features/session/templates';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, radius } from '../tokens';

/** Screen 7: the count, every exercise against its own last time, the next time, and CERRAR. */
export function SummaryView({ summary, onClose }: { summary: SessionSummary; onClose(): void }) {
  const next = summary.nextTime && nextTimeLine(summary.nextTime);
  const pending = pendingLine(summary.pending);
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>{`${summary.dayLabel} · ${summary.groupsLabel} · ${summary.duration}`}</Text>
        <View style={styles.tally}>
          {tallyLines(summary.tally).map((l, i) => (
            <Animated.Text key={l.text} entering={FadeInDown.duration(500).delay(i * 120)} style={[styles.tallyLine, styles[l.tone]]}>
              {l.text}
            </Animated.Text>
          ))}
          {pending && <Text style={styles.pending}>{pending}</Text>}
        </View>
        {summary.rows.map((r, i) => (
          <Row key={r.exerciseId} row={r} last={i === summary.rows.length - 1} />
        ))}
        {next && (
          <View style={styles.next}>
            <Text style={styles.label}>{copy.session.nextTime}</Text>
            <Text style={styles.nextText}>
              {next.before}
              <Text style={styles.bold}>{next.bold}</Text>
              {next.after}
            </Text>
          </View>
        )}
      </ScrollView>
      <Pressable onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]} accessibilityRole="button">
        <Text style={styles.closeText}>{copy.session.close}</Text>
      </Pressable>
    </View>
  );
}

/** "27 sep ~~4×8~~ → 24 kg · 4×9   +1" */
function Row({ row, last }: { row: SummaryRow; last: boolean }) {
  const { previous, today, loadBasis } = row;
  const before = previous && (previous.loadKg === today.loadKg ? formatSets(previous.reps) : `${formatLoad(previous.loadKg, loadBasis)} · ${formatSets(previous.reps)}`);
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.name}>{row.name}</Text>
      <View style={styles.cmp}>
        <Text style={styles.date}>{previous ? formatShortDate(previous.date) : copy.session.firstTime}</Text>
        {before && (
          <>
            <Text style={styles.old}>{before}</Text>
            <Text style={styles.arrow}>→</Text>
          </>
        )}
        <Text style={styles.now}>{`${formatLoad(today.loadKg, loadBasis)} · ${formatSets(today.reps)}`}</Text>
        <Text style={[styles.delta, row.verdict === 'up' && styles.up]}>{shortDelta(row.delta)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 18, paddingBottom: 16 },
  label: { ...font('label'), color: color.muted },
  tally: { marginTop: 14, marginBottom: 18 },
  tallyLine: { ...font('tally'), lineHeight: 38 },
  up: { color: color.green },
  text: { color: color.text },
  muted: { color: color.muted },
  pending: { ...font('label'), color: color.muted, marginTop: 6 },
  row: { paddingVertical: 11 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  name: { fontSize: 15, fontWeight: '600', color: color.text },
  cmp: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, marginTop: 4 },
  date: { fontSize: 12, fontWeight: '600', color: color.muted, ...tabular },
  old: { fontSize: 14, color: color.muted, textDecorationLine: 'line-through', textDecorationColor: color.border, ...tabular },
  arrow: { fontSize: 14, color: color.muted },
  now: { fontSize: 14, fontWeight: '700', color: color.text, ...tabular },
  delta: { fontSize: 13, fontWeight: '700', color: color.muted, marginLeft: 'auto', ...tabular },
  next: { marginTop: 16 },
  nextText: { fontSize: 15, lineHeight: 21, color: color.text, marginTop: 4 },
  bold: { fontWeight: '700' },
  close: { backgroundColor: color.surface, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  pressed: { opacity: 0.8 },
  closeText: { ...font('button'), color: color.text },
});
