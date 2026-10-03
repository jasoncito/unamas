import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import { haptics } from '@/services/haptics';

import { copy } from '../../copy';
import { tabular } from '../../text';
import { color, metal } from '../../tokens';
import { greenPlates, PLATES, sortPlates, type Plate } from './logic';
import { MetalRect } from './Metal';

/** Thickness and diameter of each plate, relative to a 20 kg plate 200 across (design/selector.html). */
const SHAPE: Record<Plate, { t: number; d: number }> = {
  20: { t: 30, d: 200 },
  10: { t: 24, d: 164 },
  5: { t: 18, d: 128 },
  2.5: { t: 12, d: 96 },
  1.25: { t: 9, d: 78 },
};
const GAP = 3; // between plates on the sleeve
const STAGGER_MS = 140; // first render: the suggested plates go on one by one

interface Props {
  width: number;
  height: number;
  /** Plates to load, heaviest first; a new `loadKey` loads them again (first render, "↺ sugerido"). */
  load: readonly Plate[];
  loadKey: number;
  /** Last time's plates: what's beyond them (if the total goes up) is green. */
  previous: readonly number[] | null;
  onChange(plates: Plate[]): void;
}

/** Per-side loads: a bar and a tray of plates. Tap the tray to add one, a loaded plate to take it off. */
export function PlateBar({ width, height, load, loadKey, previous, onChange }: Props) {
  const reduced = useReducedMotion();
  const [plates, setPlates] = useState<{ id: number; kg: Plate }[]>([]);
  const current = useRef<{ id: number; kg: Plate }[]>([]);
  const nextId = useRef(0);
  const shake = useSharedValue(0);

  // Every size comes from the zone: the tray is its own row; the plates scale to fit above it.
  const trayH = Math.round(Math.min(104, Math.max(64, height * 0.32)) / 8) * 8;
  const barH = height - trayH - 16;
  const scale = Math.min((barH * 0.94) / 200, (width * 0.5) / 200);
  const centerY = barH / 2;
  const collarX = Math.round(width * 0.06);
  const collarW = Math.max(8, 14 * scale);
  const sleeveX = collarX + collarW;
  const sleeveH = Math.max(10, 22 * scale);

  const set = (next: { id: number; kg: Plate }[]) => {
    const sorted = [...next].sort((a, b) => b.kg - a.kg);
    current.current = sorted;
    setPlates(sorted);
    onChange(sorted.map((p) => p.kg));
  };

  // (Re)load: off with what's there, then the plates one by one so the gesture explains itself.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const fresh = sortPlates(load).map((kg) => ({ id: ++nextId.current, kg }));
    if (reduced) {
      set(fresh);
    } else {
      set([]);
      fresh.forEach((p, i) => timers.push(setTimeout(() => set([...current.current, p]), 200 + i * STAGGER_MS)));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const used = (list: { kg: Plate }[]) => list.reduce((s, p) => s + SHAPE[p.kg].t * scale + GAP, 0);
  const add = (kg: Plate) => {
    if (sleeveX + 2 + used(current.current) + SHAPE[kg].t * scale > width - 2) {
      // The sleeve is full: the tray says no.
      haptics.warn();
      if (!reduced) shake.value = withSequence(...[-6, 6, -4, 4, 0].map((x) => withTiming(x, { duration: 50 })));
      return;
    }
    haptics.tap();
    set([...current.current, { id: ++nextId.current, kg }]);
  };
  const remove = (id: number) => {
    haptics.tap();
    set(current.current.filter((p) => p.id !== id));
  };

  const green = greenPlates(
    plates.map((p) => p.kg),
    previous,
  );
  let x = sleeveX + 2;
  const placed = plates.map((p, i) => {
    const t = SHAPE[p.kg].t * scale;
    const d = SHAPE[p.kg].d * scale;
    const at = { ...p, x, t, d, green: green[i] };
    x += t + GAP;
    return at;
  });
  const trayStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  // Tray plates: as tall as the row allows (under their label), same proportions as on the bar.
  const trayScale = (trayH - 8 - 18 - 8) / 200;

  return (
    <View style={{ width, height }}>
      <View style={{ height: barH }}>
        {/* The shaft fades into the left edge; the collar; the sleeve the plates slide along. */}
        <View style={[styles.shaft, { top: centerY - sleeveH * 0.32, width: collarX + 4, height: sleeveH * 0.64 }]} />
        <View style={{ position: 'absolute', left: sleeveX, top: centerY - sleeveH / 2 }}>
          <MetalRect width={width - sleeveX} height={sleeveH} radius={4} finish="dim" horizontal={false} />
        </View>
        <View style={{ position: 'absolute', left: collarX, top: centerY - (54 * scale) / 2 }}>
          <MetalRect width={collarW} height={54 * scale} radius={4} finish="dim" />
        </View>
        {placed.map((p) => (
          <Animated.View
            key={p.id}
            entering={reduced ? undefined : SlideInRight.springify().damping(15)}
            exiting={reduced ? undefined : SlideOutRight.duration(260)}
            layout={reduced ? undefined : LinearTransition.springify().damping(18)}
            style={{ position: 'absolute', left: p.x, top: centerY - p.d / 2 }}
          >
            <Pressable onPress={() => remove(p.id)} accessibilityRole="button" accessibilityLabel={copy.selector.removePlate(formatKg(p.kg))} hitSlop={4}>
              <MetalRect width={p.t} height={p.d} radius={Math.min(5, p.t / 3)} finish={p.green ? 'green' : 'metal'} />
              {p.t >= 12 && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Text style={[styles.plateLabel, { width: p.d, left: (p.t - p.d) / 2, top: p.d / 2 - 7, fontSize: Math.min(11, p.t * 0.55) }]}>
                    {formatKg(p.kg)}
                  </Text>
                </View>
              )}
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[styles.tray, { height: trayH, marginTop: 16 }, trayStyle]}>
        {PLATES.map((kg) => (
          <Pressable
            key={kg}
            onPress={() => add(kg)}
            style={({ pressed }) => [styles.trayItem, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={copy.selector.addPlate(formatKg(kg))}
          >
            <MetalRect width={Math.max(6, SHAPE[kg].t * trayScale)} height={SHAPE[kg].d * trayScale} radius={3} finish="dim" />
            <Text style={styles.trayLabel}>
              <Text style={styles.plus}>+</Text>
              {formatKg(kg)}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shaft: { position: 'absolute', left: 0, borderRadius: 3, backgroundColor: metal.dim, opacity: 0.7 },
  plateLabel: {
    position: 'absolute',
    textAlign: 'center',
    fontWeight: '800',
    color: color.ink,
    transform: [{ rotate: '-90deg' }],
    ...tabular,
  },
  tray: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'stretch', gap: 8 },
  trayItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderRadius: 14, paddingBottom: 8 },
  pressed: { backgroundColor: color.raised },
  trayLabel: { fontSize: 14, fontWeight: '800', color: color.text, ...tabular },
  plus: { color: color.muted },
});
