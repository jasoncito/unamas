import { StyleSheet, Text, View } from 'react-native';

import { formatKg, formatSets } from '@/domain/format';
import type { PlanLine } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, space } from '../tokens';
import { GroupsTitle } from './GroupsTitle';

/**
 * Screen 2's "hoy te toca" (design/meta.html): only what goes up is green, with "antes" below. When the
 * load goes up, SERIES says "vuelves a 6" (more load, back to the floor); "por lado" goes under the load,
 * not in the name (backlog: gym test).
 */
export function PlanTable({ title, lines, onBack }: { title: string; lines: readonly PlanLine[]; onBack?: () => void }) {
  return (
    <View>
      <View style={styles.header}>
        <View style={styles.title}>
          <GroupsTitle text={title} onBack={onBack} />
        </View>
        <Text style={[styles.colHead, styles.loadCol]}>{copy.session.load}</Text>
        <Text style={[styles.colHead, styles.setsCol]}>{copy.session.sets}</Text>
      </View>
      {lines.map((l, i) => (
        <View key={l.exerciseId} style={[styles.row, i < lines.length - 1 && styles.divider]}>
          <Text style={styles.name}>{l.name}</Text>
          <Cell
            style={styles.loadCol}
            value={`${formatKg(l.loadKg)} kg`}
            up={l.loadUp}
            notes={[
              ...(l.loadUp ? [`${copy.session.before} ${formatKg(l.before.loadKg)}`] : []),
              ...(l.loadBasis === 'per_side' ? [copy.session.perSideShort] : []),
            ]}
          />
          <Cell
            style={styles.setsCol}
            value={formatSets(l.reps)}
            up={l.setsUp}
            notes={
              l.setsUp
                ? [`${copy.session.before} ${formatSets(l.before.reps)}`]
                : l.loadUp && l.reps.every((r) => r === l.reps[0])
                  ? [copy.session.backTo(l.reps[0])]
                  : []
            }
          />
        </View>
      ))}
    </View>
  );
}

function Cell({ value, up, notes, style }: { value: string; up: boolean; notes: string[]; style: object }) {
  return (
    <View style={style}>
      <Text style={[styles.value, up && styles.up]}>{value}</Text>
      {notes.map((n) => (
        <Text key={n} style={styles.before}>
          {n}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 4 },
  title: { flex: 1 },
  colHead: { fontSize: 11, fontWeight: '600', color: color.muted, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 11 * 0.06 },
  loadCol: { width: 70, alignItems: 'flex-end' },
  setsCol: { width: 62, alignItems: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: space.rowY + 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  name: { ...font('row'), color: color.text, flex: 1, lineHeight: 19 },
  value: { fontSize: 16, fontWeight: '700', color: color.text, textAlign: 'right', lineHeight: 19, ...tabular },
  up: { color: color.green },
  before: { fontSize: 11, fontWeight: '500', color: color.muted, marginTop: 3, textAlign: 'right', ...tabular },
});
