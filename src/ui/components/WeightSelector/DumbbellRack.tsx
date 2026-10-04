import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import { haptics } from '@/services/haptics';

import { copy } from '../../copy';
import { tabular } from '../../text';
import { color } from '../../tokens';

// design/selector.html, dumbbells: every constant below comes from the approved prototype.
const LABEL_H = 52; // weight printed under each dumbbell (and the date chip)
const SHELF_H = 6;
const RUBBER = 0.35; // stretch past the ends
const PROJECT_S = 0.18; // where a fling would stop: X + v × 0.18 s
const SPRING = { stiffness: 140, damping: 2 * Math.sqrt(140) * 0.95, mass: 1 }; // the carousel's only spring
const LIFT_EASE = Easing.bezier(0.2, 0.8, 0.3, 1);
const FALL_EASE = Easing.bezier(0.55, 0, 1, 0.45); // gravity

interface Props {
  width: number;
  height: number;
  /** The rack's weights, lightest first. */
  values: readonly number[];
  initialIndex: number;
  /** A new `resetKey` springs the rack to `resetIndex` ("↺ sugerido"). */
  resetIndex: number;
  resetKey: number;
  lastKg: number | null;
  lastTag: string | null;
  /** How far the rack bleeds past the stage on each side (the screen gutter): edge to edge. */
  bleed: number;
  onChange(index: number): void;
}

/**
 * Dumbbells and per-unit loads: a rack seen from the front, dumbbells in profile on a steel shelf and the
 * weight printed under each. Its own carousel (not a scroll view): drag it, fling it, it springs to the
 * nearest one; tap one to bring it to the middle. The one in the middle is the one you lift: it comes off
 * the shelf; the one leaving falls back with gravity and lands.
 */
export function DumbbellRack({ width, height, values, initialIndex, resetIndex, resetKey, lastKg, lastTag, bleed, onChange }: Props) {
  const reduced = useReducedMotion();
  const fullW = width + bleed * 2;
  const maxKg = values[values.length - 1];
  const lift = Math.min(28, height * 0.08);
  const k = Math.max(0.5, Math.min(1.3, ((height - LABEL_H - SHELF_H - lift - 8) * 0.95) / (26 + maxKg * 1.05)));
  const dim = (kg: number) => ({ H: (26 + kg * 1.05) * k, W: (9 + kg * 0.32) * k, handle: 30 * k });
  const { widths, centers } = useMemo(() => {
    const ws = values.map((kg) => {
      const d = dim(kg);
      return Math.ceil(d.W * 2 + d.handle + 8 + 16);
    });
    let acc = 0;
    return { widths: ws, centers: ws.map((w) => (acc += w) - w / 2) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, k]);
  const snapX = (i: number) => fullW / 2 - centers[i];
  const minX = snapX(values.length - 1);
  const maxX = snapX(0);
  const topH = dim(maxKg).H + lift + 4;

  const X = useSharedValue(snapX(initialIndex));
  const X0 = useSharedValue(0);
  const [selected, setSelected] = useState(initialIndex);
  const selectedRef = useRef(initialIndex);
  const lifts = useLifts(values.length, initialIndex, -lift);
  const seats = useLifts(values.length, -1, 0);

  const select = (i: number) => {
    const prev = selectedRef.current;
    if (i === prev) return;
    selectedRef.current = i;
    setSelected(i);
    onChange(i);
    haptics.select();
    const w = values[i];
    if (reduced) {
      lifts[prev].value = 0;
      lifts[i].value = -lift;
      return;
    }
    // The new one comes off the shelf…
    lifts[i].value = withTiming(-lift, { duration: 240 + w * 7, easing: LIFT_EASE });
    // …the one leaving falls back with gravity, lands, and seats (unless it was picked up again).
    const pw = values[prev];
    const landed = () => {
      if (selectedRef.current === prev) return;
      haptics.thud(pw >= 20 ? 'medium' : 'light');
    };
    lifts[prev].value = withTiming(0, { duration: 170 + pw * 3, easing: FALL_EASE }, (ok) => {
      if (!ok) return;
      const dy = Math.min(3, 1 + pw * 0.05);
      const ms = 120 + pw * 2;
      seats[prev].value = withSequence(withTiming(dy, { duration: ms / 2, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: ms / 2, easing: Easing.out(Easing.quad) }));
      runOnJS(landed)();
    });
  };

  // The one nearest the middle is the selected one, while dragging too.
  useAnimatedReaction(
    () => {
      let best = 0;
      let bd = 1e9;
      for (let j = 0; j < centers.length; j++) {
        const d = Math.abs(centers[j] + X.value - fullW / 2);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      return best;
    },
    (i, prev) => {
      if (prev !== null && i !== prev) runOnJS(select)(i);
    },
  );

  // The stage can be measured again (its height settles after the first layout): the sizes and centers
  // change with it, so the selected dumbbell is put back in the middle.
  useEffect(() => {
    X.value = snapX(selectedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centers, fullW]);

  const goTo = (i: number, velocity = 0) => {
    X.value = reduced ? snapX(i) : withSpring(snapX(i), { ...SPRING, velocity });
  };
  useEffect(() => {
    if (resetKey > 0) goTo(resetIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const nearestTo = (x: number) => {
    let best = 0;
    for (let j = 1; j < centers.length; j++) if (Math.abs(centers[j] + x - fullW / 2) < Math.abs(centers[best] + x - fullW / 2)) best = j;
    return best;
  };
  const release = (vx: number) => {
    const proj = Math.max(minX, Math.min(maxX, X.value + vx * PROJECT_S));
    goTo(nearestTo(proj), vx);
  };
  const tapAt = (xIn: number) => {
    let best = 0;
    for (let j = 1; j < centers.length; j++) if (Math.abs(centers[j] - xIn) < Math.abs(centers[best] - xIn)) best = j;
    goTo(best);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onStart(() => {
      X0.value = X.value;
    })
    .onUpdate((e) => {
      let nx = X0.value + e.translationX;
      // Rubber band at the ends.
      if (nx > maxX) nx = maxX + (nx - maxX) * RUBBER;
      if (nx < minX) nx = minX + (nx - minX) * RUBBER;
      X.value = nx;
    })
    .onEnd((e) => runOnJS(release)(e.velocityX));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(tapAt)(e.x - X.value));

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: X.value }] }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        style={{ width: fullW, height, marginHorizontal: -bleed, overflow: 'hidden', justifyContent: 'center' }}
        accessible
        accessibilityRole="adjustable"
        accessibilityValue={{ text: copy.selector.choose(formatKg(values[selected])) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => goTo(Math.max(0, Math.min(values.length - 1, selectedRef.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
      >
        <Animated.View style={[styles.track, trackStyle]}>
          {values.map((kg, i) => {
            const d = dim(kg);
            const isSel = i === selected;
            const head = isSel ? (lastKg !== null && kg > lastKg + 1e-6 ? color.green : color.plate) : color.surface;
            return (
              <View key={kg} style={{ width: widths[i] }}>
                <View style={{ height: topH, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <Dumbbell lift={lifts[i]} seat={seats[i]} H={d.H} W={d.W} handle={d.handle} k={k} head={head} />
                </View>
                <View style={styles.shelf} />
                <View style={styles.labelBox}>
                  <Text style={[styles.label, isSel && styles.labelOn]}>{formatKg(kg)}</Text>
                  {lastKg !== null && Math.abs(kg - lastKg) < 1e-6 && lastTag && <Text style={styles.chip}>{lastTag}</Text>}
                </View>
              </View>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** A dumbbell in profile: head, inner flange, handle, flange, head. */
function Dumbbell({ lift, seat, H, W, handle, k, head }: { lift: SharedValue<number>; seat: SharedValue<number>; H: number; W: number; handle: number; k: number; head: string }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value + seat.value }] }));
  const r = W * 0.38;
  return (
    <Animated.View style={[styles.dumbbell, style]}>
      <View style={{ width: W, height: H, borderRadius: r, backgroundColor: head }} />
      <View style={[styles.flange, { height: H * 0.42 }]} />
      <View style={{ width: handle, height: Math.max(6, 7 * k), borderRadius: 3, backgroundColor: color.steel }} />
      <View style={[styles.flange, { height: H * 0.42 }]} />
      <View style={{ width: W, height: H, borderRadius: r, backgroundColor: head }} />
    </Animated.View>
  );
}

/** One animated value per dumbbell; the rack's length is fixed for an exercise. */
function useLifts(n: number, liftedIndex: number, lifted: number): SharedValue<number>[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Array.from({ length: n }, (_, i) => makeMutable(i === liftedIndex ? lifted : 0)), [n]);
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'stretch' },
  dumbbell: { flexDirection: 'row', alignItems: 'center' },
  flange: { width: 4, borderRadius: 2, backgroundColor: color.steelHi },
  shelf: { height: SHELF_H, marginHorizontal: -1, backgroundColor: color.steel },
  labelBox: { height: LABEL_H, paddingTop: 10, alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '800', color: color.muted, ...tabular },
  labelOn: { color: color.text },
  chip: { marginTop: 6, fontSize: 11, fontWeight: '800', color: color.text, backgroundColor: color.raised, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
});
