import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { shortDelta } from '@/domain/delta';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { PendingLine, TodayLine } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, radius, space } from '../tokens';
import { CheckDot } from './CheckDot';

type Row = { kind: 'logged'; line: TodayLine } | { kind: 'pending'; line: PendingLine };

/**
 * Screen 4's "Hoy": each logged exercise with today's set and its delta vs. its own last time, and
 * in gray what was saved without signal and isn't understood yet, so it isn't logged twice.
 * Tapping a row shows "Borrar" in it (visible, no hidden gesture; decided with Jason); tapping it again hides it.
 */
export function TodayList({
  lines,
  pending,
  onDelete,
}: {
  lines: readonly TodayLine[];
  pending: readonly PendingLine[];
  onDelete?(entryId: string): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows: Row[] = [
    ...lines.map((line) => ({ kind: 'logged' as const, line })),
    ...pending.map((line) => ({ kind: 'pending' as const, line })),
  ].sort((a, b) => a.line.createdAt.localeCompare(b.line.createdAt));

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{copy.session.today}</Text>
      {rows.map((r, i) => {
        const open = selected === r.line.entryId;
        return (
          <Animated.View key={r.line.entryId} entering={FadeIn.duration(300)} style={i < rows.length - 1 && styles.divider}>
            <Pressable
              onPress={onDelete ? () => setSelected(open ? null : r.line.entryId) : undefined}
              disabled={!onDelete}
              style={styles.row}
              accessibilityRole={onDelete ? 'button' : undefined}
              accessibilityState={onDelete ? { expanded: open } : undefined}
            >
              {r.kind === 'logged' ? <LoggedRow line={r.line} hideValue={open} /> : <PendingRow line={r.line} hideValue={open} />}
              {open && (
                <Pressable
                  onPress={() => {
                    setSelected(null);
                    onDelete!(r.line.entryId);
                  }}
                  style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteText}>{copy.session.delete}</Text>
                </Pressable>
              )}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

function LoggedRow({ line: l, hideValue }: { line: TodayLine; hideValue: boolean }) {
  return (
    <>
      <CheckDot />
      <View style={styles.body}>
        <Text style={styles.name}>{l.name}</Text>
        <Text style={styles.sub}>{l.comparedTo ? `${copy.session.vs} ${formatShortDate(l.comparedTo)}` : copy.session.firstTime}</Text>
      </View>
      {!hideValue && (
        <Text style={styles.value}>
          {`${formatLoad(l.loadKg, l.loadBasis)} · ${formatSets(l.reps)}`}
          <Text style={[styles.delta, l.delta.kind !== 'new' && l.delta.tone === 'up' && styles.up]}>{`  ${shortDelta(l.delta)}`}</Text>
        </Text>
      )}
    </>
  );
}

/** Their words as they said them, with the empty circle of what isn't done yet. */
function PendingRow({ line, hideValue }: { line: PendingLine; hideValue: boolean }) {
  return (
    <>
      <View style={styles.emptyDot} />
      <Text style={[styles.name, styles.muted, styles.body]} numberOfLines={2}>
        {line.rawText}
      </Text>
      {!hideValue && <Text style={styles.pending}>{copy.session.pending}</Text>}
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
  delete: { backgroundColor: color.surface, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 },
  pressed: { opacity: 0.7 },
  deleteText: { ...font('label'), color: color.text },
});
