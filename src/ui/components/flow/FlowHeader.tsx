import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font } from '../../text';
import { color } from '../../tokens';

/** Screens 2–4 (design/flujo-ejercicio.html): "‹ Pierna" to go one screen back, and the exercise's name. */
export function FlowHeader({ backLabel, name, onBack }: { backLabel: string; name: string; onBack(): void }) {
  return (
    <View>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back} accessibilityRole="button">
        <Text style={styles.backText}>{`‹ ${backLabel}`}</Text>
      </Pressable>
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { fontSize: 15, fontWeight: '600', color: color.muted },
  name: { ...font('muscle'), lineHeight: 34, color: color.text, marginTop: 8 },
});
