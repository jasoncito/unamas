import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { shortDelta } from '@/domain/delta';
import { formatLoad, formatLongDate, formatSets } from '@/domain/format';
import { loadExerciseTimeline, type ExerciseTimeline } from '@/features/history/controller';
import { copy } from '@/ui/copy';
import { HistoryScreen } from '@/ui/components/HistoryScreen';
import { font, tabular } from '@/ui/text';
import { color } from '@/ui/tokens';

// History · one exercise over time (from "La última vez" on the weight selector): each time, newest
// first, against the time before; green if it went up.
export default function ExerciseHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [timeline, setTimeline] = useState<ExerciseTimeline | null>(null);
  useEffect(() => {
    void loadExerciseTimeline(db, id).then(setTimeline);
  }, [db, id]);

  return (
    <HistoryScreen title={timeline?.exercise.canonicalName ?? ''} subtitle={timeline ? copy.history.yourSessions : undefined}>
      {timeline && timeline.rows.length === 0 && <Text style={styles.empty}>{copy.history.exerciseEmpty}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        {timeline?.rows.map((r, i) => {
          const up = r.delta.kind !== 'new' && r.delta.tone === 'up';
          return (
            <View key={r.sessionId} style={[styles.row, i < timeline.rows.length - 1 && styles.divider]}>
              <View style={styles.left}>
                <Text style={styles.date}>{formatLongDate(r.date)}</Text>
                <Text style={styles.value}>{`${formatLoad(r.loadKg, timeline.exercise.loadBasis)} · ${formatSets(r.reps)}`}</Text>
              </View>
              <Text style={[styles.delta, up && styles.up]}>{r.delta.kind === 'new' ? copy.history.firstTime : shortDelta(r.delta)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </HistoryScreen>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 14, paddingBottom: 24 },
  empty: { ...font('body'), color: color.muted, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  left: { flex: 1 },
  date: { ...font('label'), color: color.muted },
  value: { fontSize: 17, fontWeight: '700', color: color.text, marginTop: 3, ...tabular },
  delta: { fontSize: 14, fontWeight: '700', color: color.muted, ...tabular },
  up: { color: color.green },
});
