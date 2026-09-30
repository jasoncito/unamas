import { Pressable, StyleSheet, Text, View } from 'react-native';

import { localDateOf } from '@/domain/dates';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { Suggestion } from '@/features/session/controller';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color, radius } from '../tokens';

/** Screen 3: local suggestions above the input; the typed part of the name in bold. */
export function SuggestionList({ items, onPick }: { items: readonly Suggestion[]; onPick(s: Suggestion): void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.card}>
      {items.map((s, i) => (
        <Pressable
          key={s.exercise.id}
          onPress={() => onPick(s)}
          style={({ pressed }) => [styles.row, i < items.length - 1 && styles.divider, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.name}>{withBold(s.exercise.canonicalName, s.highlight)}</Text>
          <Text style={styles.last}>
            {s.last ? (
              <>
                {`${copy.session.last} `}
                <Text style={styles.lastStrong}>{`${formatLoad(s.last.loadKg, s.exercise.loadBasis)} · ${formatSets(s.last.reps)}`}</Text>
                {` · ${formatShortDate(localDateOf(s.last.createdAt))}`}
              </>
            ) : (
              copy.session.noLast
            )}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function withBold(name: string, range: [number, number] | null) {
  if (!range) return name;
  const [a, b] = range;
  return (
    <>
      {name.slice(0, a)}
      <Text style={styles.bold}>{name.slice(a, b)}</Text>
      {name.slice(b)}
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.raised, borderRadius: radius.input, overflow: 'hidden' },
  row: { paddingVertical: 12, paddingHorizontal: 16 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  pressed: { backgroundColor: color.surface },
  name: { ...font('body'), color: color.muted },
  bold: { color: color.text, fontWeight: '700' },
  last: { ...font('label'), fontWeight: '400', color: color.muted, marginTop: 3, ...tabular },
  lastStrong: { color: color.text, fontWeight: '600' },
});
