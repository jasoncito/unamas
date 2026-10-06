import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatKg } from '@/domain/format';
import { aimRange } from '@/domain/reps';
import type { ExerciseView } from '@/features/exercise/actions';

import { copy } from '../../copy';
import { font, tabular } from '../../text';
import { color, radius } from '../../tokens';
import { unitFor } from '../WeightSelector/format';

/**
 * Screen 3 · while training (design/flujo-ejercicio.html): the app only reminds. The load, the range to
 * aim for at that load, last time's reps, "cambiar peso" and "Terminé". No rep counter, no rest timer.
 */
export function TrainingView({ view, loadKg, onChangeWeight, onDone }: { view: ExerciseView; loadKg: number; onChangeWeight(): void; onDone(): void }) {
  const [floor, top] = aimRange(view.exercise, loadKg);
  const unit = unitFor(view.exercise.loadBasis);
  return (
    <View style={styles.root}>
      <Text style={styles.big}>
        {formatKg(loadKg)}
        <Text style={styles.unit}>{` ${unit}`}</Text>
      </Text>
      <View style={styles.aim}>
        <Text style={styles.aimText}>
          {copy.flow.aimBefore}
          <Text style={styles.aimRange}>{`${floor}–${top}`}</Text>
          {copy.flow.aimAfter}
        </Text>
      </View>
      {view.last && (
        <View style={styles.prev}>
          <Text style={styles.label}>{copy.flow.lastWith(`${formatKg(view.last.loadKg)} kg`)}</Text>
          <Text style={styles.reps} adjustsFontSizeToFit numberOfLines={1}>
            {view.last.reps.map((r, i) => (
              <Text key={i}>
                {i > 0 && <Text style={styles.dot}>{' · '}</Text>}
                {r}
              </Text>
            ))}
          </Text>
        </View>
      )}
      <Pressable onPress={onChangeWeight} hitSlop={10} style={styles.change} accessibilityRole="button">
        <Text style={styles.changeText}>{copy.flow.changeWeight}</Text>
      </Pressable>
      <View style={styles.spacer} />
      <Pressable onPress={onDone} style={({ pressed }) => [styles.button, pressed && styles.pressed]} accessibilityRole="button">
        <Text style={styles.buttonText}>{copy.flow.done}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  big: { fontSize: 72, lineHeight: 78, fontWeight: '800', letterSpacing: 72 * -0.04, color: color.text, marginTop: 14, ...tabular },
  unit: { fontSize: 22, fontWeight: '700', color: color.muted, letterSpacing: 0 },
  aim: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: color.raised, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  aimText: { fontSize: 15, fontWeight: '700', color: color.text },
  aimRange: { color: color.green, ...tabular },
  prev: { marginTop: 34 },
  label: { ...font('label'), color: color.muted },
  reps: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: 40 * -0.02, color: color.muted, marginTop: 6, ...tabular },
  dot: { color: color.divider },
  change: { alignSelf: 'flex-start', marginTop: 22 },
  changeText: { fontSize: 14, color: color.muted, textDecorationLine: 'underline' },
  spacer: { flex: 1 },
  button: { backgroundColor: color.green, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center' },
  pressed: { opacity: 0.85 },
  buttonText: { ...font('button'), color: color.ink },
});
