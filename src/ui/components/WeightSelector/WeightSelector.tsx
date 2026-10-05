import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { formatKg, formatSets, formatShortDate } from '@/domain/format';
import type { IsoDate, LoadBasis } from '@/domain/types';

import { copy } from '../../copy';
import { font, tabular } from '../../text';
import { color, radius, space } from '../../tokens';
import { DumbbellRack } from './DumbbellRack';
import { dayOf, deltaText, unitFor } from './format';
import { deltaLine, equipmentFor, greedyPlates, nearestIndex, rackRange, stackRange, sumPlates, type Plate } from './logic';
import { PlateBar } from './PlateBar';
import { PlateStack } from './PlateStack';
import { NumericText } from './NumericText';

export interface WeightSelectorProps {
  loadBasis: LoadBasis;
  stepKg: number;
  repFloor: number;
  /** Their last time with this exercise; `plates` = the configuration used, if it was kept. */
  last: { date: IsoDate; loadKg: number; reps: readonly number[]; plates?: readonly number[] } | null;
  /** The progression engine's target for today (never recalculated here). */
  suggestion: { loadKg: number; reps: readonly number[] } | null;
  today: IsoDate;
  /** Where it starts; the suggestion by default. */
  initialKg?: number;
  /** "Empezar con X": the weight is kept before starting (screen 3). Plates only on the bar. */
  onStart(kg: number, plates: Plate[] | null): void;
}

/**
 * Screen 2 of the per-exercise flow (design/selector.html): the selector takes the shape of the equipment
 * — a bar with plates, a weight stack, a dumbbell rack — with last time, the big number and the delta
 * line above it, always. Every size of the equipment comes from the space left between the number and
 * the button (measured), so nothing overlaps on any phone.
 */
export function WeightSelector({ loadBasis, stepKg, repFloor, last, suggestion, today, initialKg, onStart }: WeightSelectorProps) {
  const equipment = equipmentFor(loadBasis);
  const suggestedKg = suggestion?.loadKg ?? last?.loadKg ?? stepKg;
  const startKg = initialKg ?? suggestedKg;
  const unit = unitFor(loadBasis);
  const lastPlates = useMemo(() => (last ? (last.plates ? [...last.plates] : greedyPlates(last.loadKg)) : null), [last]);

  const values = useMemo(
    () => (equipment === 'stack' ? stackRange(stepKg, last?.loadKg ?? null) : equipment === 'rack' ? rackRange(stepKg) : []),
    [equipment, stepKg, last],
  );
  const [plates, setPlates] = useState<Plate[]>(() => (equipment === 'bar' ? greedyPlates(startKg) : []));
  const [initialIndex] = useState(() => nearestIndex(values, startKg));
  const [index, setIndex] = useState(initialIndex);
  const [load, setLoad] = useState(() => ({ plates: greedyPlates(startKg), key: 0 }));
  const [resetKey, setResetKey] = useState(0);
  const value = equipment === 'bar' ? sumPlates(plates) : values[index];
  const suggestedIndex = nearestIndex(values, suggestedKg);

  const [zone, setZone] = useState<{ width: number; height: number } | null>(null);
  const onZone = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!zone || Math.abs(zone.width - width) > 0.5 || Math.abs(zone.height - height) > 0.5) setZone({ width, height });
  };

  const up = last !== null && value > last.loadKg + 1e-6;
  const line = deltaLine(value, last && { loadKg: last.loadKg, day: dayOf(last.date, today) }, repFloor, suggestion);
  const isSuggested = Math.abs(value - suggestedKg) < 1e-6;
  const emptyBar = equipment === 'bar' && value === 0;
  const backToSuggested = () => {
    if (equipment === 'bar') setLoad((l) => ({ plates: greedyPlates(suggestedKg), key: l.key + 1 }));
    else setResetKey((r) => r + 1);
  };
  const lastUnit = loadBasis === 'per_side' ? ' por lado' : loadBasis === 'per_dumbbell' ? ' c/u' : '';

  return (
    <View style={styles.root}>
      {last && (
        <View style={styles.lastRow}>
          <Text style={styles.lastLabel}>{copy.selector.lastTime(formatShortDate(last.date))}</Text>
          <View style={styles.lastValue}>
            <Text style={styles.lastKg}>
              {`${formatKg(last.loadKg)} kg`}
              <Text style={styles.lastSmall}>{`${lastUnit} · ${formatSets(last.reps)}`}</Text>
            </Text>
            {equipment === 'bar' && lastPlates && lastPlates.length > 0 && (
              <Text style={styles.lastCfg}>{lastPlates.map(formatKg).join(' + ')}</Text>
            )}
          </View>
        </View>
      )}

      <View style={styles.valueBlock}>
        <View accessibilityLiveRegion="polite">
          <NumericText value={value} green={up} style={styles.number} unit={unit} unitStyle={styles.unit} />
        </View>
        <View style={styles.line}>
          {emptyBar ? (
            <Text style={styles.delta}>{copy.selector.loadTheBar}</Text>
          ) : (
            line && <Text style={[styles.delta, line.kind === 'up' && styles.up]}>{deltaText(line)}</Text>
          )}
          {emptyBar ? null : isSuggested ? (
            <Text style={styles.tag}>{copy.selector.suggested}</Text>
          ) : (
            <Pressable onPress={backToSuggested} style={({ pressed }) => [styles.reset, pressed && styles.pressed]} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.resetText}>{copy.selector.backToSuggested(formatKg(suggestedKg))}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* The zone between the number and the button: measured, and every size comes from it. */}
      <View style={[styles.zone, equipment !== 'bar' && styles.zonePad]} onLayout={onZone}>
        {zone &&
          (equipment === 'bar' ? (
            <PlateBar width={zone.width} height={zone.height} load={load.plates} loadKey={load.key} previous={lastPlates} onChange={setPlates} />
          ) : equipment === 'stack' ? (
            <PlateStack
              width={zone.width}
              height={zone.height - 16}
              values={values}
              initialIndex={initialIndex}
              resetIndex={suggestedIndex}
              resetKey={resetKey}
              lastKg={last?.loadKg ?? null}
              lastTag={last ? formatShortDate(last.date) : null}
              onChange={setIndex}
            />
          ) : (
            <DumbbellRack
              width={zone.width}
              height={zone.height - 16}
              values={values}
              initialIndex={initialIndex}
              resetIndex={suggestedIndex}
              resetKey={resetKey}
              lastKg={last?.loadKg ?? null}
              lastTag={last ? formatShortDate(last.date) : null}
              bleed={space.screenX}
              onChange={setIndex}
            />
          ))}
      </View>

      <Pressable
        onPress={() => onStart(value, equipment === 'bar' ? plates : null)}
        style={({ pressed }) => [styles.start, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.startText} numberOfLines={1} adjustsFontSizeToFit>
          {copy.selector.start(formatKg(value), unit)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  lastRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 16,
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.divider,
  },
  lastLabel: { ...font('label'), color: color.muted, flexShrink: 1 },
  lastValue: { alignItems: 'flex-end' },
  lastKg: { fontSize: 20, fontWeight: '800', color: color.text, ...tabular },
  lastSmall: { fontSize: 13, fontWeight: '600', color: color.muted },
  lastCfg: { fontSize: 12, fontWeight: '600', color: color.muted, marginTop: 2, ...tabular },
  valueBlock: { alignItems: 'center', paddingTop: 24 },
  number: { fontSize: 80, lineHeight: 84, fontWeight: '800', letterSpacing: 80 * -0.045, color: color.text, ...tabular },
  unit: { fontSize: 22, fontWeight: '700', color: color.muted, letterSpacing: 0 },
  up: { color: color.green },
  line: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 32 },
  delta: { fontSize: 15, fontWeight: '700', color: color.muted, textAlign: 'center', ...tabular },
  tag: { fontSize: 12, fontWeight: '800', color: color.text, backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  reset: { borderWidth: 1.5, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  resetText: { fontSize: 13, fontWeight: '700', color: color.text, ...tabular },
  // The stage (design/selector.html): 16 above it (the bar draws its own), 16 above the button.
  zone: { flex: 1, marginBottom: 16 },
  zonePad: { paddingTop: 16 },
  start: { backgroundColor: color.green, borderRadius: radius.pill, paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center' },
  pressed: { opacity: 0.85 },
  startText: { ...font('button'), color: color.ink, ...tabular },
});
