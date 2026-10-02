import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatShortDate } from '@/domain/format';
import { muscleGroupLabel } from '@/features/picker/groups';
import { usePicker } from '@/features/picker/store';
import { useMuscleGroups } from '@/features/picker/useMuscleGroups';
import { pastSessionActions, usePastDoubt } from '@/features/session/pastSessions';
import { useComposer } from '@/features/session/useComposer';
import { useOpenSessionRedirect } from '@/features/session/useOpenSessionRedirect';
import { haptics } from '@/services/haptics';
import { PastDoubt } from '@/ui/components/PastDoubt';
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
  const past = usePastDoubt();
  const composer = useComposer({ send: pastSessionActions.send, setText: pastSessionActions.setText, hints: [] });

  const rows = [
    ...(groups ?? []),
    ...custom.filter((c) => !groups?.some((g) => g.name === c)).map((name) => ({ name, lastDate: null })),
  ];

  // No session row yet: it's created with the first entry (CLAUDE.md §7). The groups travel with the
  // route and the selection stays, so going back shows it as it was.
  const start = () => router.push({ pathname: '/session', params: { groups: JSON.stringify(selected) } });

  // A doubt left in a session already stopped goes first, before picking groups (decided with Jason).
  if (past.active) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView style={styles.past} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <PastDoubt
            state={past.state}
            origin={past.origin}
            onChoose={pastSessionActions.choose}
            onChangeText={pastSessionActions.setText}
            onSend={() => composer.submit(past.state.text)}
            onMic={composer.toggleMic}
            listening={composer.listening}
            notice={composer.notice}
            onNotNow={pastSessionActions.dismiss}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

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
              <Pressable key={g.name} onPress={() => {
                  haptics.select();
                  toggle(g.name);
                }} style={styles.row} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.muscle, on && styles.on]}>{muscleGroupLabel(g.name)}</Text>
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
          <Text style={styles.buttonText}>{`${copy.picker.start} · ${selected.map(muscleGroupLabel).join(' + ')}`}</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  past: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 18, paddingBottom: 16 },
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
