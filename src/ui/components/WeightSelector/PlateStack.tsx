import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import { haptics } from '@/services/haptics';

import { tabular } from '../../text';
import { color, metal } from '../../tokens';
import { stackPitch } from './logic';
import { MetalRect } from './Metal';

interface Props {
  width: number;
  height: number;
  /** The plates, lightest (top) to heaviest. */
  values: readonly number[];
  /** Selected index; changing it from outside ("↺ sugerido") moves the pin there. */
  index: number;
  /** Last time's load: plates above it are green when selected; its plate gets a date tag. */
  lastKg: number | null;
  lastTag: string | null;
  onChange(index: number): void;
}

const SNAP = { damping: 20, stiffness: 220 };

/**
 * A weight stack with a pin (design/selector.html): drag anywhere on it, fling it (inertia) and it
 * settles on the nearest plate; every plate crossed clicks (selection haptic). Plates under the pin
 * part a little. Too many to fit at 26 pt: a window that follows the pin, the far plates faded.
 */
export function PlateStack({ width, height, values, index, lastKg, lastTag, onChange }: Props) {
  const reduced = useReducedMotion();
  const n = values.length;
  const pad = 8;
  const { pitch, gap, windowed } = stackPitch(height - pad * 2, n);
  const plateH = pitch - 4;
  const plateW = Math.min(200, Math.round(width * 0.5));
  const sideW = (width - plateW) / 2;
  const contentH = n * pitch + gap;

  const pos = useSharedValue(index);
  const start = useSharedValue(index);
  const [selected, setSelected] = useState(index);

  // From outside ("↺ sugerido"): the pin goes there.
  useEffect(() => {
    if (Math.round(pos.value) === index) return;
    pos.value = reduced ? index : withSpring(index, SNAP);
  }, [index, pos, reduced]);

  const select = (i: number) => {
    setSelected(i);
    haptics.select();
    onChange(i);
  };
  useAnimatedReaction(
    () => Math.round(pos.value),
    (cur, prev) => {
      if (prev !== null && cur !== prev) runOnJS(select)(Math.min(n - 1, Math.max(0, cur)));
    },
  );

  // The window: keep the pin centered, within the stack's ends.
  const offset = useSharedValue(0);
  useAnimatedReaction(
    () => pos.value,
    (p) => {
      offset.value = windowed ? Math.min(Math.max(p * pitch + pitch / 2 - (height - pad * 2) / 2, 0), contentH - (height - pad * 2)) : 0;
    },
  );
  const top0 = windowed ? pad : Math.max(pad, (height - contentH) / 2);

  const pan = Gesture.Pan()
    .onStart(() => {
      cancelAnimation(pos);
      start.value = pos.value;
    })
    .onUpdate((e) => {
      pos.value = Math.min(n - 1, Math.max(0, start.value + e.translationY / pitch));
    })
    .onEnd((e) => {
      if (reduced) {
        pos.value = Math.round(pos.value);
        return;
      }
      pos.value = withDecay({ velocity: e.velocityY / pitch, clamp: [0, n - 1], deceleration: 0.994 }, () => {
        pos.value = withSpring(Math.round(pos.value), SNAP);
      });
    });
  const tap = Gesture.Tap().onEnd((e) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor((e.y - top0 + offset.value) / pitch)));
    pos.value = reduced ? i : withSpring(i, SNAP);
  });

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -offset.value }] }));
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pos.value * pitch }] }));
  const lastIdx = lastKg === null ? -1 : values.findIndex((v) => Math.abs(v - lastKg) < 1e-6);

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={{ width, height, overflow: 'hidden' }} accessible accessibilityRole="adjustable" accessibilityValue={{ text: `${formatKg(values[selected])} kg` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const i = Math.min(n - 1, Math.max(0, selected + (e.nativeEvent.actionName === 'increment' ? 1 : -1)));
          pos.value = i;
        }}
      >
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: top0, height: contentH }, contentStyle]}>
          {values.map((kg, i) => (
            <StackPlate
              key={kg}
              i={i}
              kg={kg}
              pos={pos}
              offset={offset}
              maxOffset={contentH - (height - pad * 2)}
              windowed={windowed}
              viewH={height - pad * 2}
              pitch={pitch}
              gap={gap}
              left={sideW}
              width={plateW}
              height={plateH}
              finish={i > selected ? 'off' : lastKg !== null && kg > lastKg + 1e-6 ? 'green' : 'metal'}
              reduced={reduced}
            />
          ))}
          {lastIdx >= 0 && lastTag && (
            <View style={[styles.tagBox, { top: lastIdx * pitch + (lastIdx > selected ? gap : 0), width: sideW - 8, height: pitch }]}>
              <Text style={styles.tag}>{lastTag}</Text>
            </View>
          )}
          {/* The pin: through the selected plate, its knob to the right. */}
          <Animated.View pointerEvents="none" style={[styles.pin, { left: sideW + plateW * 0.7, height: pitch, width: Math.min(sideW - 4, pitch * 3) + plateW * 0.3 }, pinStyle]}>
            <View style={[styles.rod, { top: pitch / 2 - 3 }]} />
            <View style={[styles.knob, { width: pitch + 4, height: pitch + 4, borderRadius: (pitch + 4) / 2, top: -2 }]} />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function StackPlate(p: {
  i: number;
  kg: number;
  pos: SharedValue<number>;
  offset: SharedValue<number>;
  maxOffset: number;
  windowed: boolean;
  viewH: number;
  pitch: number;
  gap: number;
  left: number;
  width: number;
  height: number;
  finish: 'metal' | 'green' | 'off';
  reduced: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const below = p.i > Math.round(p.pos.value) ? p.gap : 0;
    const y = p.i * p.pitch + below - p.offset.value;
    // In a window, the plates near an edge fade out — only an edge with more plates beyond it.
    const top = p.offset.value > 0.5 ? y : Infinity;
    const bottom = p.offset.value < p.maxOffset - 0.5 ? p.viewH - (y + p.pitch) : Infinity;
    const edge = Math.min(top, bottom);
    return {
      transform: [{ translateY: p.reduced ? below : withTiming(below, { duration: 140 }) }],
      opacity: p.windowed ? Math.min(1, Math.max(0.12, edge / (p.pitch * 1.5))) : 1,
    };
  });
  const on = p.finish !== 'off';
  return (
    <Animated.View style={[{ position: 'absolute', top: p.i * p.pitch, left: p.left, width: p.width, height: p.height }, style]}>
      {on ? (
        <MetalRect width={p.width} height={p.height} radius={5} finish={p.finish === 'green' ? 'green' : 'metal'} horizontal={false} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.off]} />
      )}
      <View style={[StyleSheet.absoluteFill, styles.plateRow]} pointerEvents="none">
        <Text style={[styles.plateLabel, on && styles.plateLabelOn]}>{formatKg(p.kg)}</Text>
        <View style={[styles.hole, { width: p.height * 0.36, height: p.height * 0.36, borderRadius: p.height * 0.18 }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  off: { backgroundColor: color.surface, borderRadius: 5 },
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  plateLabel: { fontSize: 13, fontWeight: '800', color: color.muted, ...tabular },
  plateLabelOn: { color: color.ink },
  hole: { backgroundColor: color.bg, marginRight: 10 },
  tagBox: { position: 'absolute', left: 0, alignItems: 'flex-end', justifyContent: 'center' },
  tag: { fontSize: 11, fontWeight: '800', color: color.text, backgroundColor: color.raised, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  pin: { position: 'absolute', top: 0 },
  rod: { position: 'absolute', left: 0, right: 16, height: 6, borderRadius: 3, backgroundColor: color.text },
  knob: { position: 'absolute', right: 0, backgroundColor: metal.light, borderWidth: 2, borderColor: metal.shine },
});
