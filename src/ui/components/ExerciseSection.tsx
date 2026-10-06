import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDelta } from '@/domain/delta';
import { formatKg, formatSets, formatShortDate } from '@/domain/format';
import type { GroupSection, ListRow, PlanLine, TodayLine } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, radius, space } from '../tokens';

interface Props {
  section: GroupSection;
  /** The header's "tu última vez, 24 sep": the group's past sessions. */
  onHistory(group: string): void;
  /** A row to do: its weight (screen 2). */
  onPick(exerciseId: string): void;
  /** An "en curso" row: back to its screen 3. */
  onResume(draftId: string): void;
  /** "Borrar" on a row done today (decided with Jason: tap the row, then "Borrar"). */
  onDelete(entryId: string): void;
}

/**
 * One chosen group on the session's list (design/flujo-ejercicio.html, screen 1; design/meta.html):
 * "Pierna · tu última vez, 24 sep" and last time's exercises with today's target. Only what goes up is
 * green, with "antes" below; when the load goes up, SERIES says "vuelves a 6". Done today goes last,
 * with what was done and its comparison.
 */
export function ExerciseSection({ section, onHistory, onPick, onResume, onDelete }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const title = `${section.label} · ${section.lastDate ? copy.flow.lastTime(formatShortDate(section.lastDate)) : copy.flow.noHistory}`;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        {section.lastDate ? (
          <Pressable onPress={() => onHistory(section.group)} hitSlop={8} style={styles.title} accessibilityRole="link">
            <Text style={styles.titleText}>
              {title}
              <Text style={styles.chevronInline}> ›</Text>
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.titleText, styles.title]}>{title}</Text>
        )}
        {section.rows.length > 0 && (
          <>
            <Text style={[styles.colHead, styles.loadCol]}>{copy.session.load}</Text>
            <Text style={[styles.colHead, styles.setsCol]}>{copy.session.sets}</Text>
            <View style={styles.chevCol} />
          </>
        )}
      </View>
      {section.rows.map((r, i) => {
        const divider = i < section.rows.length - 1 && styles.divider;
        switch (r.kind) {
          case 'todo':
            return (
              <Pressable key={r.line.exerciseId} onPress={() => onPick(r.line.exerciseId)} style={({ pressed }) => [styles.row, divider, pressed && styles.pressed]} accessibilityRole="button">
                <TodoRow line={r.line} />
              </Pressable>
            );
          case 'draft':
            return (
              <Pressable key={r.draft.id} onPress={() => onResume(r.draft.id)} style={({ pressed }) => [styles.row, divider, pressed && styles.pressed]} accessibilityRole="button">
                <DraftRow row={r} />
              </Pressable>
            );
          case 'done': {
            const open = selected === r.line.entryId;
            return (
              <Pressable key={r.line.entryId} onPress={() => setSelected(open ? null : r.line.entryId)} style={[styles.row, divider]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                <DoneRow
                  line={r.line}
                  onDelete={
                    open
                      ? () => {
                          setSelected(null);
                          onDelete(r.line.entryId);
                        }
                      : undefined
                  }
                />
              </Pressable>
            );
          }
        }
      })}
    </View>
  );
}

function TodoRow({ line: l }: { line: PlanLine }) {
  const evenReps = l.reps.every((r) => r === l.reps[0]);
  return (
    <>
      <Text style={styles.name}>{l.name}</Text>
      <Cell
        style={styles.loadCol}
        value={`${formatKg(l.loadKg)} kg`}
        up={l.loadUp}
        notes={[...(l.loadUp ? [`${copy.session.before} ${formatKg(l.before.loadKg)}`] : []), ...(l.loadBasis === 'per_side' ? [copy.session.perSideShort] : [])]}
      />
      <Cell
        style={styles.setsCol}
        value={formatSets(l.reps)}
        up={l.setsUp}
        notes={l.setsUp ? [`${copy.session.before} ${formatSets(l.before.reps)}`] : l.loadUp && evenReps ? [copy.session.backTo(l.reps[0])] : []}
      />
      <Text style={[styles.chevron, styles.chevCol]}>›</Text>
    </>
  );
}

/** Started and not saved: the load chosen, "en curso". */
function DraftRow({ row }: { row: Extract<ListRow, { kind: 'draft' }> }) {
  return (
    <>
      <Text style={styles.name}>{row.name}</Text>
      <Cell style={styles.loadCol} value={`${formatKg(row.draft.loadKg)} kg`} up={false} notes={[]} />
      <View style={styles.setsCol}>
        <Text style={styles.inProgress}>{copy.flow.inProgress}</Text>
      </View>
      <Text style={[styles.chevron, styles.chevCol]}>›</Text>
    </>
  );
}

/** Done today: muted, with what was done and its comparison (green if it went up). Tapped: "Borrar". */
function DoneRow({ line: l, onDelete }: { line: TodayLine; onDelete?(): void }) {
  const up = l.delta.kind !== 'new' && l.delta.tone === 'up';
  return (
    <>
      <Text style={[styles.name, styles.muted]}>{l.name}</Text>
      {onDelete ? (
        <Pressable onPress={onDelete} style={({ pressed }) => [styles.delete, pressed && styles.pressed]} hitSlop={8} accessibilityRole="button">
          <Text style={styles.deleteText}>{copy.session.delete}</Text>
        </Pressable>
      ) : (
        <>
          <Cell style={styles.loadCol} value={`${formatKg(l.loadKg)} kg`} up={false} muted notes={[]} />
          <View style={styles.setsCol}>
            <Text style={[styles.value, styles.muted]}>{formatSets(l.reps)}</Text>
            <Text style={[styles.delta, up && styles.up]}>{shortDelta(l.delta)}</Text>
          </View>
        </>
      )}
      <View style={styles.chevCol} />
    </>
  );
}

function Cell({ value, up, muted = false, notes, style }: { value: string; up: boolean; muted?: boolean; notes: string[]; style: object }) {
  return (
    <View style={style}>
      <Text style={[styles.value, up && styles.up, muted && styles.muted]}>{value}</Text>
      {notes.map((n) => (
        <Text key={n} style={styles.before}>
          {n}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 4 },
  title: { flex: 1 },
  titleText: { ...font('label'), color: color.muted, flexShrink: 1 },
  chevronInline: { fontWeight: '700' },
  colHead: { fontSize: 11, fontWeight: '600', color: color.muted, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 11 * 0.06 },
  loadCol: { width: 70, alignItems: 'flex-end' },
  setsCol: { width: 62, alignItems: 'flex-end' },
  chevCol: { width: 12, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: space.rowY + 2 },
  pressed: { opacity: 0.6 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  name: { ...font('row'), color: color.text, flex: 1, lineHeight: 19 },
  muted: { color: color.muted },
  value: { fontSize: 16, fontWeight: '700', color: color.text, textAlign: 'right', lineHeight: 19, ...tabular },
  up: { color: color.green },
  before: { fontSize: 11, fontWeight: '500', color: color.muted, marginTop: 3, textAlign: 'right', ...tabular },
  chevron: { fontSize: 18, color: color.muted, lineHeight: 19 },
  inProgress: { fontSize: 13, fontWeight: '700', color: color.text, lineHeight: 19 },
  delta: { fontSize: 11, fontWeight: '700', color: color.muted, marginTop: 3, textAlign: 'right', ...tabular },
  delete: { backgroundColor: color.surface, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 },
  deleteText: { ...font('label'), color: color.text },
});
