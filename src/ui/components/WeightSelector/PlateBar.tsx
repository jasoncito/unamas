import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import { haptics } from '@/services/haptics';

import { copy } from '../../copy';
import { tabular } from '../../text';
import { color } from '../../tokens';
import { greenPlates, PLATES, type Plate } from './logic';

// design/selector.html, bar: every constant below comes from the approved prototype.
/** Diameter relative to D, and thickness at D = 240, per plate. */
const SPEC: Record<Plate, [number, number]> = { 20: [1, 30], 10: [0.8, 24], 5: [0.62, 19], 2.5: [0.46, 14], 1.25: [0.38, 11] };
const PAD_TOP = 16; // stage padding above the bar
const GAP = 24; // between the bar and the plate tree
const TREE_H = 96; // the plate tree's row
const SLIDE = 18; // a plate stops this far outside its place, then slides in
const OUT_MS = 440;
/** Heavier plates travel slower. */
const travel = (kg: number) => 340 + kg * 12;
const IN = Easing.bezier(0.3, 0.7, 0.3, 1);
const SLIDE_IN = Easing.bezier(0.6, 0, 1, 0.6); // accelerating along the sleeve
const OUT_1 = Easing.bezier(0.3, 0, 0.6, 1);
const OUT_2 = Easing.bezier(0.4, 0, 0.2, 1);
const SHIFT = Easing.bezier(0.4, 0, 0.2, 1);
const LAND = Easing.bezier(0.3, 0, 0.3, 1);

type Rect = { x: number; y: number; w: number; h: number; r: number };
type Loaded = { id: number; kg: Plate; landed: boolean };
type Flight = { key: string; from: Rect; to: Rect; slide: number; c0: string; c1: string; out: boolean; ms: number; done(): void };

interface Props {
  /** The stage: the space between the delta line and the button. Every size comes from it. */
  width: number;
  height: number;
  /** Plates to load in order; a new `loadKey` unloads and loads them again (opening, "↺ sugerido"). */
  load: readonly Plate[];
  loadKey: number;
  /** Last time's plates: what goes beyond them (if the total goes up) is green. */
  previous: readonly number[] | null;
  onChange(plates: Plate[]): void;
}

/**
 * Per-side loads: the whole bar seen from the front, plates mirrored on both sleeves, and a plate tree
 * below (circles face-on, as on the gym's rack). Tap a circle to load a plate on the outside, a plate to
 * take it off. Plates fly in two moves — through the air to just outside their place, then along the
 * sleeve — and the bar dips when they land, more for heavier ones.
 */
export function PlateBar({ width, height, load, loadKey, previous, onChange }: Props) {
  const reduced = useReducedMotion();
  const [plates, setPlates] = useState<Loaded[]>([]);
  const current = useRef<Loaded[]>([]);
  const nextId = useRef(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  const barDy = useSharedValue(0);
  const tree = useTreeAnims();

  // Geometry, all from the stage's size.
  const barH = Math.max(40, height - PAD_TOP - GAP - TREE_H);
  const D = Math.min(barH - 8, 220);
  const k = D / 240;
  const cy = PAD_TOP + barH / 2;
  const cx = width / 2;
  const half = Math.max(30, width * 0.1);
  const cw = 8;
  const inL = cx - half - cw;
  const inR = cx + half + cw;
  const dims = (kg: Plate) => {
    const T = Math.max(6, SPEC[kg][1] * k);
    return { D: D * SPEC[kg][0], T, r: Math.min(4, T / 3) };
  };
  const offset = (list: readonly Loaded[], i: number) => list.slice(0, i).reduce((x, p) => x + dims(p.kg).T + 2, 2);
  const plateRect = (list: readonly Loaded[], i: number, side: 'L' | 'R'): Rect => {
    const { D: d, T, r } = dims(list[i].kg);
    const o = offset(list, i);
    return { x: side === 'L' ? inL - o - T : inR + o, y: cy - d / 2, w: T, h: d, r };
  };
  const fits = (kg: Plate) => inL - (offset(current.current, current.current.length) + dims(kg).T) >= 4;

  // The tree: circles of max(44, 30 + 2.6w), space-around in their row.
  const diam = (kg: Plate) => Math.max(44, 30 + kg * 2.6);
  const unit = (width - PLATES.reduce((s, kg) => s + diam(kg), 0)) / PLATES.length;
  const treeTop = PAD_TOP + barH + GAP;
  const circleRect = (kg: Plate): Rect => {
    const i = PLATES.indexOf(kg);
    const x = PLATES.slice(0, i).reduce((s, w) => s + diam(w) + unit, 0) + unit / 2;
    const d = diam(kg);
    return { x, y: treeTop + TREE_H / 2 - d / 2, w: d, h: d, r: d / 2 };
  };

  const set = (next: Loaded[]) => {
    current.current = next;
    setPlates(next);
    onChange(next.map((p) => p.kg));
  };
  const isGreen = (list: readonly Loaded[], i: number) =>
    greenPlates(
      list.map((p) => p.kg),
      previous,
    )[i];
  const fly = (f: Omit<Flight, 'key'>) => setFlights((cur) => [...cur, { ...f, key: `${Date.now()}-${Math.random()}` }]);

  const landed = (id: number) => {
    const p = current.current.find((q) => q.id === id);
    if (!p) return;
    set(current.current.map((q) => (q.id === id ? { ...q, landed: true } : q)));
    // The bar takes the weight: it dips and comes back, more for heavier plates.
    const dy = Math.min(4, 0.18 * p.kg + 1);
    const ms = 150 + p.kg * 6;
    barDy.value = withSequence(withTiming(dy, { duration: ms / 2, easing: LAND }), withTiming(0, { duration: ms / 2, easing: LAND }));
    haptics.thud(p.kg >= 10 ? 'heavy' : p.kg >= 5 ? 'medium' : 'light');
  };

  const add = (kg: Plate) => {
    if (!fits(kg)) {
      // The sleeve is full: the tree's plate shakes no.
      haptics.warn();
      if (!reduced) tree.shake(kg);
      return;
    }
    const p: Loaded = { id: ++nextId.current, kg, landed: reduced };
    const list = [...current.current, p]; // on the outside, in the order tapped — never sorted
    set(list);
    if (reduced) return;
    const i = list.length - 1;
    const c1 = isGreen(list, i) ? color.green : color.plate;
    const ms = travel(kg) * 1.25;
    let arrived = 0;
    const done = () => {
      arrived += 1;
      if (arrived === 2) landed(p.id);
    };
    const from = circleRect(kg);
    fly({ from, to: plateRect(list, i, 'L'), slide: -SLIDE, c0: color.surface, c1, out: false, ms, done });
    fly({ from, to: plateRect(list, i, 'R'), slide: SLIDE, c0: color.surface, c1, out: false, ms, done });
  };

  const remove = (id: number) => {
    const list = current.current;
    const i = list.findIndex((p) => p.id === id);
    if (i < 0 || !list[i].landed) return;
    const c0 = isGreen(list, i) ? color.green : color.plate;
    const fromL = plateRect(list, i, 'L');
    const fromR = plateRect(list, i, 'R');
    const kg = list[i].kg;
    set(list.filter((p) => p.id !== id)); // the outer plates slide in
    haptics.tap();
    if (reduced) return;
    const to = circleRect(kg);
    let back = 0;
    const done = () => {
      back += 1;
      if (back === 2) tree.pulse(kg);
    };
    fly({ from: fromL, to, slide: -SLIDE, c0, c1: color.surface, out: true, ms: OUT_MS, done });
    fly({ from: fromR, to, slide: SLIDE, c0, c1: color.surface, out: true, ms: OUT_MS, done });
  };

  // Opening and "↺ sugerido": unload outside-in, then load the plates in sequence, each one starting
  // while the previous is still on its way.
  useEffect(() => {
    if (reduced) {
      set(load.map((kg) => ({ id: ++nextId.current, kg, landed: true })));
      return;
    }
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      const out = [...current.current].reverse();
      if (out.length === 0) await wait(350);
      for (const p of out) {
        if (cancelled) return;
        remove(p.id);
        await wait(60);
      }
      if (out.length) await wait(300);
      for (const kg of load) {
        if (cancelled) return;
        add(kg);
        await wait(travel(kg) * 0.75);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: barDy.value }] }));
  const shaftH = Math.max(8, D * 0.045);
  const sleeveH = Math.max(14, D * 0.075);
  const collarH = Math.max(34, D * 0.22);
  const green = greenPlates(
    plates.map((p) => p.kg),
    previous,
  );

  return (
    <View style={{ width, height }}>
      <Animated.View style={[StyleSheet.absoluteFill, barStyle]}>
        <View style={[styles.sleeve, { left: -4, width: inL + 4, top: cy - sleeveH / 2, height: sleeveH }]} />
        <View style={[styles.sleeve, { left: inR, width: width - inR + 4, top: cy - sleeveH / 2, height: sleeveH }]} />
        <View style={[styles.shaft, { left: cx - half, width: half * 2, top: cy - shaftH / 2, height: shaftH }]} />
        <View style={[styles.sleeve, { left: cx - half - cw, width: cw, top: cy - collarH / 2, height: collarH }]} />
        <View style={[styles.sleeve, { left: cx + half, width: cw, top: cy - collarH / 2, height: collarH }]} />
        {plates.flatMap((p, i) =>
          (['L', 'R'] as const).map((side) => (
            <BarPlate
              key={`${p.id}${side}`}
              rect={plateRect(plates, i, side)}
              kg={p.kg}
              fill={green[i] ? color.green : color.plate}
              visible={p.landed}
              reduced={reduced}
              onPress={() => remove(p.id)}
            />
          )),
        )}
      </Animated.View>

      {PLATES.map((kg) => (
        <TreePlate key={kg} kg={kg} rect={circleRect(kg)} shakeX={tree.shakeOf[kg]} scale={tree.scaleOf[kg]} onPress={() => add(kg)} />
      ))}

      {flights.map((f) => (
        <Flyer key={f.key} f={f} onEnd={() => setFlights((cur) => cur.filter((x) => x.key !== f.key))} />
      ))}
    </View>
  );
}

/** A plate on a sleeve. When plates come off, the outer ones slide in (260 ms). */
function BarPlate({ rect, kg, fill, visible, reduced, onPress }: { rect: Rect; kg: Plate; fill: string; visible: boolean; reduced: boolean; onPress(): void }) {
  const left = useSharedValue(rect.x);
  useEffect(() => {
    left.value = reduced ? rect.x : withTiming(rect.x, { duration: 260, easing: SHIFT });
  }, [rect.x, left, reduced]);
  const style = useAnimatedStyle(() => ({ left: left.value }));
  return (
    <Animated.View style={[{ position: 'absolute', top: rect.y, width: rect.w, height: rect.h, opacity: visible ? 1 : 0 }, style]}>
      <Pressable
        onPress={onPress}
        hitSlop={{ left: 5, right: 5 }}
        style={{ flex: 1, borderRadius: rect.r, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={copy.selector.removePlate(formatKg(kg))}
      >
        {rect.w >= 12 && (
          <Text numberOfLines={1} style={[styles.plateLabel, { width: rect.h, fontSize: Math.min(12, rect.w * 0.55) }]}>
            {formatKg(kg)}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** A plate in flight: from the tree's circle to its place on the sleeve, or back. It changes shape and color on the way. */
function Flyer({ f, onEnd }: { f: Flight; onEnd(): void }) {
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);
  const via: Rect = f.out ? { ...f.from, x: f.from.x + f.slide } : { ...f.to, x: f.to.x + f.slide };
  useEffect(() => {
    const finish = () => {
      f.done();
      onEnd();
    };
    const [ms1, e1, ms2, e2] = f.out ? [f.ms * 0.3, OUT_1, f.ms * 0.7, OUT_2] : [f.ms * 0.7, IN, f.ms * 0.3, SLIDE_IN];
    t1.value = withTiming(1, { duration: ms1, easing: e1 }, (ok) => {
      if (ok) t2.value = withTiming(1, { duration: ms2, easing: e2 }, (ok2) => ok2 && runOnJS(finish)());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const second = t2.value > 0;
    const a = second ? via : f.from;
    const b = second ? f.to : via;
    const t = second ? t2.value : t1.value;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      left: lerp(a.x, b.x),
      top: lerp(a.y, b.y),
      width: lerp(a.w, b.w),
      height: lerp(a.h, b.h),
      borderRadius: lerp(a.r, b.r),
      // In: it becomes a loaded plate while flying; out: back to the tree's color on the way home.
      backgroundColor: interpolateColor(f.out ? t2.value : t1.value, [0, 1], [f.c0, f.c1]),
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, style]} />;
}

/** Per tree plate: a shake (the sleeve is full) and a pulse (a plate came back to it). */
function useTreeAnims() {
  const shakeOf: Record<Plate, SharedValue<number>> = {
    20: useSharedValue(0),
    10: useSharedValue(0),
    5: useSharedValue(0),
    2.5: useSharedValue(0),
    1.25: useSharedValue(0),
  };
  const scaleOf: Record<Plate, SharedValue<number>> = {
    20: useSharedValue(1),
    10: useSharedValue(1),
    5: useSharedValue(1),
    2.5: useSharedValue(1),
    1.25: useSharedValue(1),
  };
  return {
    shakeOf,
    scaleOf,
    shake(kg: Plate) {
      shakeOf[kg].value = withSequence(withTiming(-5, { duration: 60 }), withTiming(5, { duration: 120 }), withTiming(0, { duration: 60 }));
    },
    pulse(kg: Plate) {
      scaleOf[kg].value = withSequence(withTiming(1.08, { duration: 0 }), withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }));
    },
  };
}

function TreePlate({ kg, rect, shakeX, scale, onPress }: { kg: Plate; rect: Rect; shakeX: SharedValue<number>; scale: SharedValue<number>; onPress(): void }) {
  const pressed = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }, { scale: scale.value * pressed.value }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => (pressed.value = withTiming(0.94, { duration: 120 }))}
        onPressOut={() => (pressed.value = withTiming(1, { duration: 120 }))}
        style={[styles.treePlate, { borderRadius: rect.r }]}
        accessibilityRole="button"
        accessibilityLabel={copy.selector.addPlateBothSides(formatKg(kg))}
      >
        <Text style={styles.treeLabel}>{formatKg(kg)}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sleeve: { position: 'absolute', borderRadius: 3, backgroundColor: color.steelHi },
  shaft: { position: 'absolute', borderRadius: 2, backgroundColor: color.steel },
  plateLabel: { textAlign: 'center', fontWeight: '800', color: color.ink, transform: [{ rotate: '-90deg' }], ...tabular },
  treePlate: { flex: 1, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  treeLabel: { fontSize: 15, fontWeight: '800', color: color.text, ...tabular },
});
