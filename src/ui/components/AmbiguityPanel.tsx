import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import type { AmbiguityOption } from '@/features/session/reducer';

import { copy } from '../copy';
import { font, tabular } from '../text';
import { color } from '../tokens';

interface Props {
  said: string;
  question: string;
  options: readonly AmbiguityOption[];
  onChoose(exerciseId: string): void;
}

/** Screen 5: it asks instead of guessing. Their phrase, the question and a button per option. */
export function AmbiguityPanel({ said, question, options, onChoose }: Props) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.panel}>
      <Text style={styles.said}>{`“${said}”`}</Text>
      <Text style={styles.ask}>{question}</Text>
      <View style={styles.options}>
        {options.map((o) => (
          <Pressable
            key={o.exerciseId}
            onPress={() => onChoose(o.exerciseId)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.label}>{o.label}</Text>
            <Text style={styles.last}>
              {o.lastLoadKg === null ? copy.session.noLastLoad : `${copy.session.lastLoad} ${formatKg(o.lastLoadKg)} kg`}
            </Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.divider },
  said: { fontSize: 14, color: color.muted, lineHeight: 19, marginBottom: 8 },
  ask: { fontSize: 17, fontWeight: '700', color: color.text, marginTop: 4, marginBottom: 10 },
  options: { gap: 8 },
  option: {
    backgroundColor: color.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: 16, fontWeight: '600', color: color.text, flexShrink: 1 },
  last: { ...font('label'), fontWeight: '500', color: color.muted, ...tabular },
});
