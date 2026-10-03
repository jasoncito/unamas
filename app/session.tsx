import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  interpolate,
  LayoutAnimationConfig,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { suggestionsFor, textAfterPicking } from '@/features/session/controller';
import { pastSessionActions } from '@/features/session/pastSessions';
import { useComposer } from '@/features/session/useComposer';
import { useSessionScreen } from '@/features/session/useSessionScreen';
import { haptics } from '@/services/haptics';
import { useIsOnline } from '@/services/network';
import { copy } from '@/ui/copy';
import { AmbiguityPanel } from '@/ui/components/AmbiguityPanel';
import { Bubble } from '@/ui/components/Bubble';
import { Flood } from '@/ui/components/Flood';
import { GroupsTitle } from '@/ui/components/GroupsTitle';
import { InputBar } from '@/ui/components/InputBar';
import { PlanTable } from '@/ui/components/PlanTable';
import { SessionBar } from '@/ui/components/SessionBar';
import { SuggestionList } from '@/ui/components/SuggestionList';
import { SummaryView } from '@/ui/components/SummaryView';
import { TodayList } from '@/ui/components/TodayList';
import { font } from '@/ui/text';
import { color, space } from '@/ui/tokens';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
/** How blurred the content is when the stop completes (1–100; the mockup's 2 px is subtle). */
const MAX_BLUR = 18;

// Screens 2–7 are states of this one route (CLAUDE.md §4.2).
export default function SessionRoute() {
  const params = useLocalSearchParams<{ groups?: string; startedAt?: string }>();
  const pending = params.groups ? (JSON.parse(params.groups) as string[]) : null;
  const { screen, state, setText, send, choose, undo, deleteEntry, end, close } = useSessionScreen(
    pending,
    () => router.replace('/'),
    params.startedAt ?? null,
  );
  const flood = useSharedValue(0);
  // Their exercise names and aliases help the recognizer with "jalón", "Smith"…
  const hints = useMemo(() => (screen ? screen.exercises.flatMap((e) => [e.canonicalName, ...e.aliases]) : []), [screen]);
  const composer = useComposer({ send, setText, hints });
  const online = useIsOnline();

  // While the stop is held the content moves away and blurs (the bar stays sharp); the green covers it once it ends.
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(flood.value, [0, 1], [1, 0.94]) }] }));
  const blurProps = useAnimatedProps(() => ({ intensity: flood.value * MAX_BLUR }));

  // The count was shown: the green recedes downwards and leaves the summary.
  useEffect(() => {
    if (state.phase === 'summary') flood.value = withTiming(0, { duration: 600, easing: Easing.bezier(0.6, 0, 0.2, 1) });
  }, [state.phase, flood]);

  const suggestions = useMemo(
    () => (screen && state.phase !== 'disambiguating' ? suggestionsFor(state.text, screen) : []),
    [state.text, state.phase, screen],
  );
  if (!screen) return <View style={styles.screen} />;

  // Back to screen 1 only while there are no entries: the "‹" in the header and the iOS gesture.
  const onBack = screen.canGoBack ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined;
  const started = screen.sessionId !== null;
  const hasToday = screen.today.length + screen.pending.length > 0;
  const onSend = () => {
    if (!state.text.trim() && !composer.photo) return;
    Keyboard.dismiss();
    composer.submit(state.text);
  };
  const onEnd = async () => {
    Keyboard.dismiss();
    if (!(await end())) flood.value = withTiming(0, { duration: 350 });
  };
  const onUndo = async () => {
    haptics.tap();
    const undone = await undo();
    if (undone?.photo) composer.restorePhoto(undone.photo);
  };
  const onClose = () => {
    close();
    router.replace('/');
    pastSessionActions.retry();
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ gestureEnabled: screen.canGoBack }} />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        {state.phase === 'summary' ? (
          <View style={styles.content}>
            <SummaryView summary={state.summary} onClose={onClose} />
          </View>
        ) : (
          <LayoutAnimationConfig skipEntering>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              {screen.startedAt && (
                <View style={styles.bar}>
                  <SessionBar
                    groupsLabel={screen.groupsLabel}
                    startedAt={screen.startedAt}
                    flood={flood}
                    onEnd={onEnd}
                    stopTip={state.phase === 'ready' ? state.stopTip : undefined}
                    showStop={started}
                    onBack={onBack}
                  />
                </View>
              )}
              <Animated.View style={[styles.content, contentStyle]}>
                <ScrollView
                  style={styles.planScroll}
                  contentContainerStyle={styles.planContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {hasToday && <TodayList lines={screen.today} pending={screen.pending} onDelete={deleteEntry} />}
                  {screen.plan.length > 0 ? (
                    // The bar above already says the groups and holds "‹".
                    <PlanTable title={copy.session.planTitleStarted} lines={screen.plan} />
                  ) : (
                    !screen.startedAt && !hasToday && !started && <GroupsTitle text={screen.groupsLabel} onBack={onBack} />
                  )}
                </ScrollView>

                {(state.phase === 'sending' || state.phase === 'feedback') && (
                  <Bubble
                    key={state.bubble + (state.image ?? '')}
                    text={state.bubble}
                    image={state.image}
                    pending={state.phase === 'sending'}
                    feedback={state.phase === 'feedback' ? state.feedback : null}
                    onUndo={state.phase === 'feedback' ? onUndo : undefined}
                  />
                )}

                {state.phase === 'disambiguating' ? (
                  <AmbiguityPanel said={state.said} image={state.image} question={state.question} options={state.options} onChoose={choose} />
                ) : suggestions.length > 0 ? (
                  <SuggestionList items={suggestions} onPick={(s) => setText(textAfterPicking(s.exercise))} />
                ) : (
                  <>
                    {composer.notice ? (
                      <Text style={styles.reply}>{composer.notice}</Text>
                    ) : !online ? (
                      // Always visible while there's no signal: anotar never waits for the network.
                      <Text style={styles.reply}>{copy.session.noSignal}</Text>
                    ) : (
                      state.phase === 'ready' && state.reply && <Text style={styles.reply}>{state.reply}</Text>
                    )}
                    {composer.photo ? (
                      <Text style={styles.hint}>{copy.session.photoHint}</Text>
                    ) : (
                      <Text style={styles.title}>{started ? copy.session.nextTitle : copy.session.firstTitle}</Text>
                    )}
                  </>
                )}

                <InputBar
                  value={state.text}
                  onChangeText={setText}
                  onSend={onSend}
                  onMic={composer.toggleMic}
                  listening={composer.listening}
                  onCamera={composer.takePhoto}
                  photo={composer.photo}
                  onRemovePhoto={composer.removePhoto}
                  placeholder={
                    state.phase === 'disambiguating'
                      ? copy.session.otherPlaceholder
                      : started
                        ? copy.session.nextPlaceholder
                        : (screen.placeholder ?? copy.session.genericPlaceholder)
                  }
                />
                {started && <AnimatedBlurView tint="dark" animatedProps={blurProps} style={StyleSheet.absoluteFill} pointerEvents="none" />}
              </Animated.View>
            </KeyboardAvoidingView>
          </LayoutAnimationConfig>
        )}
      </SafeAreaView>
      <Flood flood={flood} summary={state.phase === 'ending' ? state.summary : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  bar: { paddingHorizontal: space.screenX, paddingTop: 12 },
  content: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 12, paddingBottom: 16, gap: 10 },
  planScroll: { flex: 1 },
  planContent: { flexGrow: 1 },
  title: { ...font('title'), color: color.text },
  reply: { ...font('body'), color: color.muted, lineHeight: 21 },
  hint: { ...font('label'), fontWeight: '400', color: color.muted },
});
