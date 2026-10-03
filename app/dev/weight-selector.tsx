import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import seed from '../../dev/seed.json';

import { nextTarget } from '@/domain/engine';
import { DEV_SCREENS } from '@/features/dev/useDevLaunch';
import { formatKg } from '@/domain/format';
import type { ExerciseKind, Exposure, LoadBasis } from '@/domain/types';
import { WeightSelector } from '@/ui/components/WeightSelector';
import { font } from '@/ui/text';
import { color, radius, space } from '@/ui/tokens';

// Development only: the weight selector alone, with three exercises of the seed — one per equipment.
// Open it with unamas:///dev/weight-selector?ex=bar|stack|rack&state=sugerido|subido, or for screenshots:
// xcrun simctl launch <sim> com.jasoncito.unamas -devScreen bar:subido (see src/features/dev/useDevLaunch.ts).
const TODAY = '2026-09-29';
const EXERCISES = { bar: 'sentadilla_smith', stack: 'laterales_polea', rack: 'press_hombro_mancuernas' } as const;
type Kind = keyof typeof EXERCISES;

function dataFor(kind: Kind) {
  const ex = seed.exercises.find((e) => e.id === EXERCISES[kind])!;
  const dateOf = new Map(seed.sessions.map((s) => [s.id, s.date]));
  const history: Exposure[] = seed.entries
    .filter((e) => e.exercise_id === ex.id && e.load_kg !== null)
    .map((e) => ({ date: dateOf.get(e.session_id)!, loadKg: e.load_kg!, reps: e.reps }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const config = { kind: ex.kind as ExerciseKind, repFloor: ex.rep_floor, repTop: ex.rep_top, stepKg: ex.step_kg };
  // The suggestion comes from the progression engine as it is.
  const target = nextTarget(history, config, TODAY);
  const last = history.at(-1) ?? null;
  return {
    name: ex.canonical_name,
    loadBasis: ex.load_basis as LoadBasis,
    stepKg: ex.step_kg,
    repFloor: ex.rep_floor,
    last: last && { date: last.date, loadKg: last.loadKg, reps: last.reps },
    suggestion: target && { loadKg: target.loadKg, reps: target.reps },
  };
}

export default function WeightSelectorDev() {
  const params = useLocalSearchParams<{ ex?: string; state?: string }>();
  const [kind, setKind] = useState<Kind>(params.ex === 'stack' || params.ex === 'rack' ? params.ex : 'bar');
  const [raised, setRaised] = useState(params.state === 'subido');
  const [started, setStarted] = useState<string | null>(null);
  if (!DEV_SCREENS) return <Redirect href="/" />;

  const d = dataFor(kind);
  const initialKg = raised && d.suggestion ? d.suggestion.loadKg + d.stepKg : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.tabs}>
        {(['bar', 'stack', 'rack'] as const).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[styles.tab, kind === k && styles.tabOn]}>
            <Text style={[styles.tabText, kind === k && styles.tabTextOn]}>{k}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setRaised((r) => !r)} style={[styles.tab, raised && styles.tabOn]}>
          <Text style={[styles.tabText, raised && styles.tabTextOn]}>{raised ? 'subido' : 'sugerido'}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.back}>{started ? `‹ → pantalla 3 con ${started}` : '‹'}</Text>
      </Pressable>
      <Text style={styles.name}>{d.name}</Text>
      <WeightSelector
        key={`${kind}-${raised}`}
        loadBasis={d.loadBasis}
        stepKg={d.stepKg}
        repFloor={d.repFloor}
        last={d.last}
        suggestion={d.suggestion}
        today={TODAY}
        initialKg={initialKg}
        onStart={(kg) => setStarted(`${formatKg(kg)} kg`)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.screenX, paddingBottom: 16 },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: color.raised, borderRadius: radius.pill, padding: 4, marginTop: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
  tabOn: { backgroundColor: color.surface },
  tabText: { ...font('label'), color: color.muted },
  tabTextOn: { color: color.text },
  back: { ...font('body'), color: color.muted, marginTop: 8 },
  name: { fontSize: 28, fontWeight: '800', letterSpacing: 28 * -0.02, color: color.text, marginTop: 8, marginBottom: 16 },
});
