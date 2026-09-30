import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatShortDate } from '@/domain/format';
import { usePicker } from '@/features/picker/store';
import { useMuscleGroups } from '@/features/picker/useMuscleGroups';
import { useOpenSessionRedirect } from '@/features/session/useOpenSessionRedirect';
import { copy } from '@/ui/copy';
import { font, tabular } from '@/ui/text';
import { color, radius, space } from '@/ui/tokens';

// Screen 1 · pick the muscle groups (CLAUDE.md §8).
export default function PickerScreen() {
  useOpenSessionRedirect();
  const groups = useMuscleGroups();
  const { selected, custom, toggle, addCustom } = usePicker();
  const [writingOther, setWritingOther] = useState(false);
  const [other, setOther] = useState('');

  const rows = [
    ...(groups ?? []),
    ...custom.filter((c) => !groups?.some((g) => g.name === c)).map((name) => ({ name, lastDate: null })),
  ];

  // No session row yet: it's created with the first entry (CLAUDE.md §7). The groups travel with the
  // route and the selection stays, so going back shows it as it was.
  const start = () => router.push({ pathname: '/session', params: { groups: JSON.stringify(selected) } });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{copy.picker.title}</Text>
        <Text style={styles.subtitle}>{copy.picker.subtitle}</Text>
        <View style={styles.list}>
          {rows.map((g) => {
            const order = selected.indexOf(g.name);
            const on = order >= 0;
            return (
              <Pressable key={g.name} onPress={() => toggle(g.name)} style={styles.row} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.muscle, on && styles.on]}>{capitalize(g.name)}</Text>
                <Text style={styles.date}>{g.lastDate ? formatShortDate(g.lastDate) : copy.picker.never}</Text>
                {on && <Text style={styles.order}>{order + 1}</Text>}
              </Pressable>
            );
          })}
          {writingOther ? (
            <TextInput
              style={[styles.other, styles.otherInput]}
              value={other}
              onChangeText={setOther}
              placeholder={copy.picker.otherPlaceholder}
              placeholderTextColor={color.border}
              selectionColor={color.green}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => {
                addCustom(other);
                setOther('');
                setWritingOther(false);
              }}
              onBlur={() => setWritingOther(false)}
            />
          ) : (
            <Pressable onPress={() => setWritingOther(true)} style={styles.row} accessibilityRole="button">
              <Text style={styles.other}>{copy.picker.other}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      {selected.length > 0 && (
        <Pressable onPress={start} style={({ pressed }) => [styles.button, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.buttonText}>{`${copy.picker.start} · ${selected.map(capitalize).join(' + ')}`}</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingTop: 18, paddingBottom: 24 },
  title: { ...font('title'), color: color.text },
  subtitle: { ...font('label'), color: color.muted, marginTop: 2 },
  list: { marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  muscle: { ...font('muscle'), color: color.text, flex: 1, lineHeight: 33 },
  on: { color: color.green },
  date: { ...font('label'), color: color.muted, marginLeft: 12, ...tabular },
  order: { ...font('muscle'), letterSpacing: 30 * -0.03, color: color.green, width: 26, marginLeft: 14, textAlign: 'right', lineHeight: 33, ...tabular },
  other: { fontSize: 22, fontWeight: '700', color: color.muted },
  otherInput: { color: color.text, paddingVertical: 7 },
  button: { backgroundColor: color.green, borderRadius: radius.pill, paddingVertical: 13, marginHorizontal: space.screenX, marginBottom: 8, alignItems: 'center' },
  pressed: { opacity: 0.85 },
  buttonText: { ...font('button'), color: color.ink },
});
