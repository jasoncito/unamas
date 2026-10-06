import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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

import { deltaOf } from '@/domain/delta';
import { muscleGroupLabel } from '@/features/picker/groups';
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
import { ExerciseSection } from '@/ui/components/ExerciseSection';
import { FlowHeader } from '@/ui/components/flow/FlowHeader';
import { RepsView } from '@/ui/components/flow/RepsView';
import { TrainingView } from '@/ui/components/flow/TrainingView';
import { SessionBar } from '@/ui/components/SessionBar';
import { SuggestionList } from '@/ui/components/SuggestionList';
import { SummaryView } from '@/ui/components/SummaryView';
import { TodayList } from '@/ui/components/TodayList';
import { WeightSelector } from '@/ui/components/WeightSelector';
import { localDateOf } from '@/domain/dates';
import { font } from '@/ui/text';
import { color, space } from '@/ui/tokens';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
/** How blurred the content is when the stop completes (1–100; the mockup's 2 px is subtle). */
const MAX_BLUR = 18;

// Screens 2–7 are states of this one route (CLAUDE.md §4.2), and so are the per-exercise flow's
// (design/flujo-ejercicio.html): the list, the weight, training and the reps.
export default function SessionRoute() {
  const params = useLocalSearchParams<{ groups?: string; startedAt?: string }>();
  const pending = params.groups ? (JSON.parse(params.groups) as string[]) : null;
  const session = useSessionScreen(pending, () => router.replace('/'), params.startedAt ?? null);
  const { screen, state, setText, send, choose, undo, deleteEntry, end, close, flow } = session;
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

  // Android's back button goes one screen back inside the flow, like "‹".
  const inFlow = flow.screen !== 'list';
  useEffect(() => {
    if (!inFlow) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      session.back();
      return true;
    });
    return () => sub.remove();
  }, [inFlow, session]);

  const suggestions = useMemo(
    () => (screen && state.phase !== 'disambiguating' ? suggestionsFor(state.text, screen) : []),
    [state.text, state.phase, screen],
  );
  if (!screen) return <View style={styles.screen} />;

  // Back to screen 1 only while there are no entries: the "‹" in the header and the iOS gesture.
  const onBack = screen.canGoBack ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined;
  const started = screen.sessionId !== null;
  const hasToday = screen.today.length + screen.pending.length > 0;
  const openHistory = (group: string) => router.push({ pathname: '/history', params: { group } });
  const openExerciseHistory = (exerciseId: string) => router.push({ pathname: '/history/exercise/[id]', params: { id: exerciseId } });
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
      {/* Inside the flow the iOS gesture would leave the session: "‹" goes one screen back instead. */}
      <Stack.Screen options={{ gestureEnabled: screen.canGoBack && !inFlow }} />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        {state.phase === 'summary' ? (
          <View style={styles.content}>
            <SummaryView summary={state.summary} onClose={onClose} />
          </View>
        ) : inFlow ? (
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.flowContent}>{session.view && <FlowScreen session={session} onLast={openExerciseHistory} />}</View>
          </KeyboardAvoidingView>
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
                    showStop={screen.hasEntries}
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
                  {!screen.startedAt && !started && <GroupsTitle text={screen.groupsLabel} onBack={onBack} />}
                  {screen.sections.map((section) => (
                    <ExerciseSection
                      key={section.group}
                      section={section}
                      onHistory={openHistory}
                      onPick={session.pick}
                      onResume={session.resume}
                      onDelete={deleteEntry}
                    />
                  ))}
                  {/* Said through the input and of no chosen group, or waiting for signal. */}
                  {hasToday && <TodayList lines={screen.today} pending={screen.pending} onDelete={deleteEntry} />}
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
                    {composer.photo && <Text style={styles.hint}>{copy.session.photoHint}</Text>}
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
                  placeholder={state.phase === 'disambiguating' ? copy.session.otherPlaceholder : copy.flow.otherPlaceholder}
                  // The list is the main way now: the keyboard opens when they tap the input.
                  autoFocus={false}
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

/** Screens 2–4 of the flow: the weight, training, the reps. */
function FlowScreen({ session, onLast }: { session: ReturnType<typeof useSessionScreen>; onLast(exerciseId: string): void }) {
  const { flow, view, screen } = session;
  if (flow.screen === 'list' || !view || !screen) return null;
  const ex = view.exercise;
  // "‹ Pierna": the section the exercise is listed under, or its own first group.
  const section = screen.sections.find((s) => s.rows.some((r) => (r.kind === 'done' ? r.line.exerciseId : r.kind === 'draft' ? r.exerciseId : r.line.exerciseId) === ex.id));
  const backLabel = section?.label ?? muscleGroupLabel(ex.muscleGroups[0] ?? '');
  const onSave = () => {
    if (flow.screen !== 'reps') return;
    const today = { date: '', loadKg: flow.loadKg, reps: flow.reps };
    const delta = deltaOf(view.last && { ...view.last }, today, ex.repFloor);
    haptics.logged(delta.kind !== 'new' && delta.tone === 'up');
    session.save();
  };
  return (
    <>
      <FlowHeader backLabel={backLabel} name={ex.canonicalName} onBack={session.back} />
      {flow.screen === 'weight' ? (
        <WeightSelector
          // A new selector for each exercise and each draft: it starts at the load it's given.
          key={`${ex.id}:${flow.draft?.id ?? 'new'}`}
          loadBasis={ex.loadBasis}
          stepKg={ex.stepKg}
          repFloor={ex.repFloor}
          last={view.last}
          suggestion={view.suggestion}
          today={localDateOf(new Date().toISOString())}
          initialKg={flow.draft?.loadKg}
          onStart={(kg) => session.start(kg)}
          onLastPress={() => onLast(ex.id)}
        />
      ) : flow.screen === 'training' ? (
        <TrainingView view={view} loadKg={flow.loadKg} onChangeWeight={session.changeWeight} onDone={session.done} />
      ) : (
        <RepsView
          view={view}
          loadKg={flow.loadKg}
          reps={flow.reps}
          onSetRep={(index, reps) => session.flowDispatch({ type: 'SET_REP', index, reps })}
          onAddSet={() => session.flowDispatch({ type: 'ADD_SET' })}
          onRemoveSet={(index) => session.flowDispatch({ type: 'REMOVE_SET', index })}
          onSay={session.say}
          onSave={onSave}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  bar: { paddingHorizontal: space.screenX, paddingTop: 12 },
  content: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 12, paddingBottom: 16, gap: 10 },
  flowContent: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 12, paddingBottom: 16 },
  planScroll: { flex: 1 },
  planContent: { flexGrow: 1 },
  reply: { ...font('body'), color: color.muted, lineHeight: 21 },
  hint: { ...font('label'), fontWeight: '400', color: color.muted },
});
