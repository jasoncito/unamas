import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { suggestionsFor, textAfterPicking } from '@/features/session/controller';
import { useSessionScreen } from '@/features/session/useSessionScreen';
import { copy } from '@/ui/copy';
import { AmbiguityPanel } from '@/ui/components/AmbiguityPanel';
import { Bubble } from '@/ui/components/Bubble';
import { GroupsTitle } from '@/ui/components/GroupsTitle';
import { InputBar } from '@/ui/components/InputBar';
import { PlanTable } from '@/ui/components/PlanTable';
import { SuggestionList } from '@/ui/components/SuggestionList';
import { TodayList } from '@/ui/components/TodayList';
import { font } from '@/ui/text';
import { color, space } from '@/ui/tokens';

// Screens 2–7 are states of this one route (CLAUDE.md §4.2). M5: screens 2–5.
export default function SessionRoute() {
  const params = useLocalSearchParams<{ groups?: string }>();
  const pending = params.groups ? (JSON.parse(params.groups) as string[]) : null;
  const { screen, state, setText, send, choose } = useSessionScreen(pending, () => router.replace('/'));

  const suggestions = useMemo(
    () => (screen && state.phase !== 'disambiguating' ? suggestionsFor(state.text, screen) : []),
    [state.text, state.phase, screen],
  );
  if (!screen) return <View style={styles.screen} />;

  // Back to screen 1 only while there are no entries: the "‹" in the header and the iOS gesture.
  const onBack = screen.canGoBack ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined;
  const started = screen.sessionId !== null;
  const onSend = () => {
    if (!state.text.trim()) return;
    Keyboard.dismiss();
    send(state.text);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ gestureEnabled: screen.canGoBack }} />
      <LayoutAnimationConfig skipEntering>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.content}>
            <ScrollView style={styles.planScroll} contentContainerStyle={styles.planContent} keyboardShouldPersistTaps="handled">
              {screen.today.length > 0 && <TodayList lines={screen.today} />}
              {screen.plan.length > 0 ? (
                <PlanTable title={`${screen.groupsLabel} · ${copy.session.planTitle}`} lines={screen.plan} onBack={onBack} />
              ) : (
                screen.today.length === 0 && <GroupsTitle text={screen.groupsLabel} onBack={onBack} />
              )}
            </ScrollView>

            {(state.phase === 'sending' || state.phase === 'feedback') && (
              <Bubble
                key={state.bubble}
                text={state.bubble}
                pending={state.phase === 'sending'}
                feedback={state.phase === 'feedback' ? state.feedback : null}
              />
            )}

            {state.phase === 'disambiguating' ? (
              <AmbiguityPanel said={state.said} question={state.question} options={state.options} onChoose={choose} />
            ) : suggestions.length > 0 ? (
              <SuggestionList items={suggestions} onPick={(s) => setText(textAfterPicking(s.exercise))} />
            ) : (
              <>
                {state.phase === 'ready' && state.reply && <Text style={styles.reply}>{state.reply}</Text>}
                <Text style={styles.title}>{started ? copy.session.nextTitle : copy.session.firstTitle}</Text>
              </>
            )}

            <InputBar
              value={state.text}
              onChangeText={setText}
              onSend={onSend}
              placeholder={
                state.phase === 'disambiguating'
                  ? copy.session.otherPlaceholder
                  : started
                    ? copy.session.nextPlaceholder
                    : (screen.placeholder ?? copy.session.genericPlaceholder)
              }
            />
          </View>
        </KeyboardAvoidingView>
      </LayoutAnimationConfig>
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
  reply: { ...font('body'), color: color.muted, lineHeight: 21 },
});
