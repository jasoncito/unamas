import { Pressable, StyleSheet, Text } from 'react-native';

import { font } from '../text';
import { color } from '../tokens';

/**
 * The session's groups over the plan. With `onBack` (no entries yet) it starts with "‹" and tapping it
 * goes back to screen 1: a visible way back, not only the iOS gesture (CLAUDE.md §1).
 */
export function GroupsTitle({ text, onBack }: { text: string; onBack?: () => void }) {
  if (!onBack) return <Text style={styles.title}>{text}</Text>;
  return (
    <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" style={styles.pressable}>
      <Text style={styles.title}>
        <Text style={styles.chevron}>‹ </Text>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { flex: 1 },
  title: { ...font('label'), color: color.muted, flexShrink: 1 },
  chevron: { fontSize: 17, fontWeight: '600' },
});
