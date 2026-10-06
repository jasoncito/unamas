import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatLoad, formatLongDate, formatSets } from '@/domain/format';
import { loadSessionList, type SessionListItem } from '@/features/history/controller';
import { muscleGroupLabel } from '@/features/picker/groups';
import { copy } from '@/ui/copy';
import { HistoryScreen } from '@/ui/components/HistoryScreen';
import { font, tabular } from '@/ui/text';
import { color, space } from '@/ui/tokens';

// History · past sessions, newest first: all of them ("Tus sesiones", screen 1), or a group's (the header
// of its section). Each opens the whole session.
export default function SessionListRoute() {
  const { group } = useLocalSearchParams<{ group?: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  useEffect(() => {
    void loadSessionList(db, group ?? null).then(setItems);
  }, [db, group]);

  return (
    <HistoryScreen title={group ? muscleGroupLabel(group) : copy.history.yourSessions} subtitle={group ? copy.history.yourSessions : undefined}>
      {items && items.length === 0 && <Text style={styles.empty}>{copy.history.empty}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        {items?.map((s, i) => (
          <Pressable
            key={s.sessionId}
            onPress={() => router.push({ pathname: '/history/[id]', params: { id: s.sessionId } })}
            style={({ pressed }) => [styles.session, i < items.length - 1 && styles.divider, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={styles.head}>
              <Text style={styles.date}>{formatLongDate(s.date)}</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
            <Text style={styles.meta}>{s.duration ? `${s.groupsLabel} · ${s.duration}` : s.groupsLabel}</Text>
            {s.rows.map((r) => (
              <View key={r.exerciseId} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.value}>{`${formatLoad(r.loadKg, r.loadBasis)} · ${formatSets(r.reps)}`}</Text>
              </View>
            ))}
          </Pressable>
        ))}
      </ScrollView>
    </HistoryScreen>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 14, paddingBottom: 24 },
  empty: { ...font('body'), color: color.muted, marginTop: 18 },
  session: { paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  pressed: { opacity: 0.6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  date: { ...font('title'), color: color.text },
  chevron: { fontSize: 18, color: color.muted },
  meta: { ...font('label'), color: color.muted, marginTop: 2, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: space.rowY / 2 },
  name: { ...font('row'), color: color.text, flex: 1 },
  value: { fontSize: 15, fontWeight: '600', color: color.text, ...tabular },
});
