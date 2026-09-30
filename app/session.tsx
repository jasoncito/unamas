import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateOf } from '@/domain/dates';
import { loadSessionScreen, suggestionsFor, textAfterPicking, type SessionScreen } from '@/features/session/controller';
import { copy } from '@/ui/copy';
import { InputBar } from '@/ui/components/InputBar';
import { PlanTable } from '@/ui/components/PlanTable';
import { SuggestionList } from '@/ui/components/SuggestionList';
import { font } from '@/ui/text';
import { color, space } from '@/ui/tokens';

// Screens 2–7 are states of this one route (CLAUDE.md §4.2). M4: screens 2 (first exercise) and 3 (typing).
export default function SessionRoute() {
  const db = useSQLiteContext();
  const [screen, setScreen] = useState<SessionScreen | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    loadSessionScreen(db, localDateOf(new Date().toISOString())).then((s) => (s ? setScreen(s) : router.replace('/')));
  }, [db]);

  const suggestions = useMemo(() => (screen ? suggestionsFor(text, screen) : []), [text, screen]);
  if (!screen) return <View style={styles.screen} />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <ScrollView style={styles.planScroll} contentContainerStyle={styles.planContent} keyboardShouldPersistTaps="handled">
            {screen.plan.length > 0 && (
              <PlanTable title={`${screen.groupsLabel} · ${copy.session.planTitle}`} lines={screen.plan} />
            )}
          </ScrollView>
          {suggestions.length > 0 ? (
            <SuggestionList items={suggestions} onPick={(s) => setText(textAfterPicking(s.exercise))} />
          ) : (
            <Text style={styles.title}>{copy.session.firstTitle}</Text>
          )}
          <InputBar value={text} onChangeText={setText} placeholder={screen.placeholder ?? copy.session.genericPlaceholder} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 12, paddingBottom: 16, gap: 10 },
  planScroll: { flex: 1 },
  planContent: { flexGrow: 1 },
  title: { ...font('title'), color: color.text },
});
