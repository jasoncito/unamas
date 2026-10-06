import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { formatKg } from '@/domain/format';
import type { ExerciseView, InterpretResult } from '@/features/exercise/actions';
import { useComposer } from '@/features/session/useComposer';

import { copy } from '../../copy';
import { font, tabular } from '../../text';
import { color, radius, space } from '../../tokens';
import { InputBar } from '../InputBar';
import { unitFor } from '../WeightSelector/format';

interface Props {
  view: ExerciseView;
  loadKg: number;
  reps: readonly number[];
  onSetRep(index: number, reps: number): void;
  onAddSet(): void;
  onRemoveSet(index: number): void;
  /** "O dilo como siempre": typed or dictated. */
  onSay(text: string): Promise<InterpretResult>;
  onSave(): void;
}

/**
 * Screen 4 · what was done (design/flujo-ejercicio.html): one row per set with − and +, "antes M" from
 * last time; "+ Agregar serie", and swiping a set left removes it (the hint under the rows says so:
 * no hidden gestures). Or said as always ("3 de 8 y una de 7"), which fills the rows.
 */
export function RepsView({ view, loadKg, reps, onSetRep, onAddSet, onRemoveSet, onSay, onSave }: Props) {
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const say = async (said: string) => {
    if (!said.trim()) return;
    setNotice(null);
    const result = await onSay(said);
    if (result === 'filled') setText('');
    else setNotice(result === 'offline' ? copy.flow.offline : copy.flow.unclear);
  };
  const composer = useComposer({ send: (t) => void say(t), setText, hints: [] });
  const before = view.last?.reps ?? [];

  return (
    <View style={styles.root}>
      <Text style={styles.label}>{copy.flow.withLoad(`${formatKg(loadKg)} ${unitFor(view.exercise.loadBasis)}`)}</Text>
      <Text style={styles.question}>{copy.flow.howMany}</Text>
      <ScrollView style={styles.rows} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {reps.map((r, i) => (
          <ReanimatedSwipeable
            // Keyed by position and count: removing a set rebuilds the rows, so none stays swiped open.
            key={`${i}/${reps.length}`}
            enabled={reps.length > 1}
            friction={2}
            rightThreshold={40}
            renderRightActions={() => (
              <Pressable onPress={() => onRemoveSet(i)} style={styles.remove} accessibilityRole="button">
                <Text style={styles.removeText}>{copy.flow.removeSet}</Text>
              </Pressable>
            )}
          >
            <View style={styles.row}>
              <Text style={styles.set}>{copy.flow.set(i + 1)}</Text>
              <View style={styles.counter}>
                <Pressable onPress={() => onSetRep(i, r - 1)} style={({ pressed }) => [styles.step, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={copy.flow.fewer}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.reps}>{r}</Text>
                <Pressable onPress={() => onSetRep(i, r + 1)} style={({ pressed }) => [styles.step, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={copy.flow.more}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.was}>{before[i] !== undefined ? copy.flow.before(before[i]) : ''}</Text>
            </View>
          </ReanimatedSwipeable>
        ))}
        <Pressable onPress={onAddSet} hitSlop={6} style={styles.add} accessibilityRole="button">
          <Text style={styles.addText}>{copy.flow.addSet}</Text>
        </Pressable>
        {reps.length > 1 && <Text style={styles.hint}>{copy.flow.swipeHint}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        {(notice ?? composer.notice) && <Text style={styles.notice}>{notice ?? composer.notice}</Text>}
        <Text style={[styles.label, styles.sayLabel]}>{copy.flow.sayIt}</Text>
        <InputBar
          value={text}
          onChangeText={setText}
          onSend={() => composer.submit(text)}
          onMic={composer.toggleMic}
          listening={composer.listening}
          placeholder={copy.flow.sayPlaceholder}
          autoFocus={false}
        />
        <Pressable onPress={onSave} style={({ pressed }) => [styles.button, pressed && styles.pressedButton]} accessibilityRole="button">
          <Text style={styles.buttonText}>{copy.flow.save}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  label: { ...font('label'), color: color.muted, marginTop: 4 },
  question: { ...font('title'), color: color.text, marginTop: 14 },
  rows: { flex: 1, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, backgroundColor: color.bg, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.divider },
  set: { fontSize: 15, fontWeight: '600', color: color.muted, width: 64 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  step: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  stepText: { fontSize: 22, fontWeight: '700', color: color.text, lineHeight: 26 },
  reps: { fontSize: 26, fontWeight: '800', color: color.text, width: 40, textAlign: 'center', ...tabular },
  was: { fontSize: 12, color: color.muted, width: 54, textAlign: 'right', ...tabular },
  remove: { backgroundColor: color.surface, justifyContent: 'center', paddingHorizontal: space.screenX, marginLeft: 8 },
  removeText: { ...font('label'), color: color.text },
  add: { alignSelf: 'flex-start', paddingVertical: 12 },
  addText: { fontSize: 15, fontWeight: '700', color: color.text },
  hint: { fontSize: 12, color: color.muted },
  bottom: { paddingTop: 8, gap: 6 },
  notice: { ...font('body'), color: color.muted, lineHeight: 21 },
  sayLabel: { marginTop: 0 },
  button: { backgroundColor: color.green, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  pressedButton: { opacity: 0.85 },
  buttonText: { ...font('button'), color: color.ink },
});
