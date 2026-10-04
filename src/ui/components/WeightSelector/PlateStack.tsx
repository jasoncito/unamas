import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
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

import { tabular } from '../../text';
import { color } from '../../tokens';
import { stackPitch } from './logic';

// design/selector.html, stack: every constant below comes from the approved prototype.
const TOP_PAD = 28; // the cable from the top down to the first plate
const PIN_MS = 160;
const PIN_EASE = Easing.bezier(0.5, 0, 0.2, 1);
const SCROLL_EASE = Easing.bezier(0.4, 0, 0.2, 1);

interface Props {
  width: number;
  height: number;
  /** The plates, lightest (top) to heaviest. */
  values: readonly number[];
  /** Where the pin starts. */
  initialIndex: number;
  /** A new `resetKey` walks the pin, plate by plate, to `resetIndex` ("↺ sugerido"). */
  resetIndex: number;
  resetKey: number;
  /** Last time's load: plates above it are green when selected; its plate gets a date tag. */
  lastKg: number | null;
  lastTag: string | null;
  onChange(index: number): void;
}

/**
 * A weight stack seen from the front: cable from the top, two guide rods, the weight printed on each
 * plate and the pin in its hole. Selected = the plates from the top down to the pin. Drag anywhere on
 * the stack; fling and the pin keeps clicking through plates, slower each time. Let go and the pin is
 * pushed home: the whole stack sinks a little on it and comes back. Nothing lifts.
 */
export function PlateStack({ width, height, values, initialIndex, resetIndex, resetKey, lastKg, lastTag, onChange }: Props) {
  const reduced = useReducedMotion();
  const n = values.length;
  const { pitch } = stackPitch(height - TOP_PAD - 8, n);
  const ph = pitch - 4;
  const pw = Math.min(220, width * 0.6);
  const x = (width - pw) / 2;
  const contentH = TOP_PAD + n * pitch;
  const windowed = contentH > height;
  const maxOff = Math.max(0, contentH - height + 8);
  const kd = Math.min(30, ph + 6);
  const lastIdx = lastKg === null ? -1 : values.findIndex((v) => Math.abs(v - lastKg) < 1e-6);

  const [pin, setPinState] = useState(initialIndex);
  const pinRef = useRef(initialIndex);
  const offFor = (i: number) => (windowed ? Math.max(0, Math.min(TOP_PAD + i * pitch - height / 2, maxOff)) : 0);
  const off = useSharedValue(offFor(initialIndex));
  const knobY = useSharedValue(TOP_PAD + initialIndex * pitch + ph / 2 - kd / 2);
  const knobScale = useSharedValue(1);
  const sink = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPin = (i: number, tick = true) => {
    const next = Math.max(0, Math.min(n - 1, i));
    if (next === pinRef.current) return;
    pinRef.current = next;
    setPinState(next);
    onChange(next);
    haptics.select();
    const y = TOP_PAD + next * pitch + ph / 2 - kd / 2;
    if (reduced) {
      knobY.value = y;
      off.value = offFor(next);
      return;
    }
    knobY.value = withTiming(y, { duration: PIN_MS, easing: PIN_EASE });
    off.value = withTiming(offFor(next), { duration: 250, easing: SCROLL_EASE });
    if (tick) knobScale.value = withSequence(withTiming(0.88, { duration: 0 }), withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }));
  };

  /** The pin is pushed home and the selected block seats on it: it sinks and comes back. */
  const settle = () => {
    if (reduced) return;
    const count = pinRef.current + 1;
    const ms = 130 + count * 6;
    const dy = Math.min(3, 1.5 + count * 0.1);
    knobScale.value = withSequence(withTiming(1.16, { duration: 0 }), withTiming(1, { duration: Math.max(140, ms), easing: Easing.out(Easing.quad) }));
    sink.value = withSequence(withTiming(dy, { duration: ms / 2, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: ms / 2, easing: Easing.out(Easing.quad) }));
    haptics.thud(count > 4 ? 'medium' : 'light');
  };

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  /** Walks the pin to `target` one plate at a time, the steps spacing out (fling), then settles. */
  const walk = (target: number, first: number, factor: number) => {
    stop();
    const t = Math.max(0, Math.min(n - 1, target));
    const dir = Math.sign(t - pinRef.current);
    const go = (d: number) => {
      if (pinRef.current === t || dir === 0) {
        settle();
        return;
      }
      timer.current = setTimeout(() => {
        setPin(pinRef.current + dir);
        go(d * factor);
      }, d);
    };
    go(first);
  };
  useEffect(() => stop, []);

  // "↺ sugerido": plate by plate (45 ms), then it settles.
  useEffect(() => {
    if (resetKey === 0) return;
    if (reduced) {
      setPin(resetIndex, false);
      return;
    }
    walk(resetIndex, 45, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const pinFromY = (y: number) => Math.round((y + off.value - sink.value - TOP_PAD - ph / 2) / pitch);
  const down = (y: number) => {
    stop();
    setPin(pinFromY(y));
  };
  const move = (y: number) => setPin(pinFromY(y));
  const up = (vyPxPerSec: number) => {
    const v = vyPxPerSec / 1000; // px per ms
    if (Math.abs(v) < 0.35 || reduced) {
      settle();
      return;
    }
    walk(pinRef.current + Math.round(v * 6), 40, 1.3);
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => runOnJS(down)(e.y))
    .onUpdate((e) => runOnJS(move)(e.y))
    .onEnd((e) => runOnJS(up)(e.velocityY));

  const stackStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sink.value - off.value }] }));
  const cableStyle = useAnimatedStyle(() => ({ height: TOP_PAD + sink.value, transform: [{ translateY: -off.value }] }));
  const knobStyle = useAnimatedStyle(() => ({ top: knobY.value, transform: [{ scale: knobScale.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ width, height, overflow: 'hidden' }}
        accessible
        accessibilityRole="adjustable"
        accessibilityValue={{ text: `${formatKg(values[pin])} kg` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setPin(pinRef.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
      >
        <Animated.View style={[styles.cable, { left: width / 2 - 1.5 }, cableStyle]} />
        <Animated.View style={[StyleSheet.absoluteFill, stackStyle]}>
          {[x + pw * 0.14, x + pw * 0.86 - 4].map((left) => (
            <View key={left} style={[styles.rod, { left, top: 0, height: contentH }]} />
          ))}
          {values.map((kg, i) => (
            <StackPlate
              key={kg}
              i={i}
              kg={kg}
              top={TOP_PAD + i * pitch}
              left={x}
              width={pw}
              height={ph}
              fill={i > pin ? 'off' : i > lastIdx && lastIdx >= 0 ? 'up' : 'on'}
              off={off}
              maxOff={maxOff}
              viewH={height}
              windowed={windowed}
            />
          ))}
          {lastIdx >= 0 && lastTag && (
            <View style={[styles.tagBox, { top: TOP_PAD + lastIdx * pitch, height: ph, right: width - x + 10 }]}>
              <Text style={styles.tag}>{lastTag}</Text>
            </View>
          )}
          {/* The pin: flat, in the hole of its plate. */}
          <Animated.View pointerEvents="none" style={[styles.knob, { left: width / 2 - kd / 2, width: kd, height: kd, borderRadius: kd / 2 }, knobStyle]}>
            <View style={[styles.knobCenter, { borderRadius: kd }]} />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function StackPlate(p: {
  i: number;
  kg: number;
  top: number;
  left: number;
  width: number;
  height: number;
  fill: 'off' | 'on' | 'up';
  off: SharedValue<number>;
  maxOff: number;
  viewH: number;
  windowed: boolean;
}) {
  // In a window, plates near an edge fade (only an edge with more plates beyond it). Solid colors, no gradient.
  const style = useAnimatedStyle(() => {
    if (!p.windowed) return { opacity: 1 };
    const y = p.top - p.off.value;
    const topEdge = p.off.value > 2 ? y : Infinity;
    const bottomEdge = p.off.value < p.maxOff - 2 ? p.viewH - (y + p.height) : Infinity;
    return { opacity: Math.min(1, Math.max(0.1, Math.min(topEdge, bottomEdge) / 40)) };
  });
  const on = p.fill !== 'off';
  return (
    <Animated.View
      style={[
        styles.plate,
        { top: p.top, left: p.left, width: p.width, height: p.height, backgroundColor: p.fill === 'up' ? color.green : on ? color.plate : color.surface },
        style,
      ]}
    >
      <Text style={[styles.plateLabel, { fontSize: Math.min(14, p.height * 0.5), color: on ? color.ink : color.muted }]}>{formatKg(p.kg)}</Text>
      <View style={styles.hole} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cable: { position: 'absolute', top: 0, width: 3, borderRadius: 2, backgroundColor: color.steel },
  rod: { position: 'absolute', width: 4, borderRadius: 2, backgroundColor: color.steel },
  plate: { position: 'absolute', borderRadius: 4, justifyContent: 'center', paddingLeft: 12 },
  plateLabel: { fontWeight: '800', ...tabular },
  hole: { position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: 4, backgroundColor: color.bg },
  tagBox: { position: 'absolute', justifyContent: 'center' },
  tag: { fontSize: 11, fontWeight: '800', color: color.text, backgroundColor: color.raised, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  knob: { position: 'absolute', backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' },
  knobCenter: { width: '40%', height: '40%', backgroundColor: color.steelHi },
});
