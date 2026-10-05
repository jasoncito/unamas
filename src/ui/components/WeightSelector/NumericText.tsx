import { useEffect, useState } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';

import { color } from '../../tokens';
import { digitSlots, POINT, type DigitSlot } from './logic';

const MS = 260;
const STAGGER_MS = 20;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
function timing(delay: number, to: number) {
  'worklet';
  return withDelay(delay, withTiming(to, { duration: MS, easing: EASE }));
}
const resize = LinearTransition.duration(MS).easing(EASE);

interface Props {
  value: number;
  green: boolean;
  style: StyleProp<TextStyle>;
  unit: string;
  unitStyle: StyleProp<TextStyle>;
}

/**
 * The big number, as SwiftUI's numericText: each digit sits in a window one line tall and only the ones
 * that change move. Going up, the old digit slides out the top and the new one comes in from the bottom
 * (going down, the reverse), a full line, right to left 20 ms apart. The point and the unit never slide;
 * the width follows when a place appears or goes, and the green comes in with the digits. Reduce Motion:
 * it just changes.
 */
export function NumericText({ value, green, style, unit, unitStyle }: Props) {
  const reduced = useReducedMotion();
  const { fontSize = 0, lineHeight = fontSize * 1.2 } = StyleSheet.flatten(style);
  const leaveTo = useSharedValue(-lineHeight);
  const [shown, setShown] = useState(() => ({ value, slots: digitSlots(formatKg(value), []), up: true }));
  if (value !== shown.value) {
    const up = value > shown.value;
    // A place that goes away leaves the same way as the digits that change (read when it unmounts).
    leaveTo.value = up ? -lineHeight : lineHeight;
    setShown({ value, slots: digitSlots(formatKg(value), shown.slots), up });
  }

  const tint = useSharedValue(green ? 1 : 0);
  useEffect(() => {
    tint.value = reduced ? Number(green) : withTiming(Number(green), { duration: MS, easing: EASE });
  }, [green, reduced, tint]);
  const tintStyle = useAnimatedStyle(() => ({ color: interpolateColor(tint.value, [0, 1], [color.text, color.green]) }));

  const enterFrom = shown.up ? lineHeight : -lineHeight;
  const changed = shown.slots.filter((s) => s.changed);
  const delayOf = (s: DigitSlot) => (changed.length - 1 - changed.indexOf(s)) * STAGGER_MS;
  const animated = !reduced;
  const layout = animated ? resize : undefined;
  const line = { height: lineHeight };

  return (
    <LayoutAnimationConfig skipEntering>
      <Animated.View layout={layout} style={[styles.row, line]} accessible accessibilityLabel={`${formatKg(value)} ${unit}`}>
        {shown.slots.map((s) => {
          const moves = animated && s.place !== POINT;
          return (
            <Animated.View key={s.place} layout={layout} exiting={moves ? leave(leaveTo) : undefined} style={[styles.window, line]}>
              {moves && s.replaced !== null && (
                <Animated.Text key={`out${s.version}`} entering={slide(delayOf(s), 0, -enterFrom)} style={[style, tintStyle, styles.out, { transform: [{ translateY: -enterFrom }] }]}>
                  {s.replaced}
                </Animated.Text>
              )}
              <Animated.Text key={s.version} entering={moves ? slide(delayOf(s), enterFrom, 0) : undefined} style={[style, tintStyle]}>
                {s.char}
              </Animated.Text>
            </Animated.View>
          );
        })}
        <Animated.Text layout={layout} style={unitStyle}>{` ${unit}`}</Animated.Text>
      </Animated.View>
    </LayoutAnimationConfig>
  );
}

/** A digit's move on mount, from y0 to y1. The one leaving stays out of its window afterwards. */
function slide(delay: number, y0: number, y1: number) {
  return () => {
    'worklet';
    return { initialValues: { transform: [{ translateY: y0 }] }, animations: { transform: [{ translateY: timing(delay, y1) }] } };
  };
}

/** A place that goes away slides out of the line the way the value went. */
function leave(to: SharedValue<number>) {
  return () => {
    'worklet';
    return { initialValues: { transform: [{ translateY: 0 }] }, animations: { transform: [{ translateY: timing(0, to.value) }] } };
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', overflow: 'hidden' },
  window: { overflow: 'hidden' },
  out: { position: 'absolute', left: 0, top: 0 },
});
