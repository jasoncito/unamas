import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { haptics } from '@/services/haptics';

import { copy } from '../copy';
import { color } from '../tokens';

/** Hold time to end (CLAUDE.md §8, §11.2: to validate at the gym). */
export const HOLD_MS = 1500;
const SHORT_TAP_MS = 400;
const TIP_MS = 2200;
const SIZE = 52;
const R = 24;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Same curve as the mockup's flood: slow start, fast end. */
const FLOOD_EASING = Easing.bezier(0.55, 0, 0.9, 0.6);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** 0 → 1: how far the green has risen; the screen's Flood and content read it too. */
  flood: SharedValue<number>;
  onComplete(): void;
  /** Bumped when "listo" was said: show "Mantén para terminar". */
  tipSignal?: number;
}

/**
 * Screen 6's stop: a short tap shows the tip; holding 1.5 s fills the ring and the screen with green
 * and ends the session. Letting go before drains it. Haptics stronger as it goes.
 */
export function StopButton({ flood, onComplete, tipSignal }: Props) {
  const ring = useSharedValue(0);
  const scale = useSharedValue(1);
  const [holding, setHolding] = useState(false);
  const [tip, setTip] = useState(false);
  const downAt = useRef(0);
  const timers = useRef<{ done?: ReturnType<typeof setTimeout>; buzz?: ReturnType<typeof setInterval>; tip?: ReturnType<typeof setTimeout> }>({});
  const completed = useRef(false);

  const showTip = () => {
    setTip(true);
    clearTimeout(timers.current.tip);
    timers.current.tip = setTimeout(() => setTip(false), TIP_MS);
  };

  useEffect(() => {
    if (tipSignal) showTip();
  }, [tipSignal]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.done);
      clearInterval(t.buzz);
      clearTimeout(t.tip);
    };
  }, []);

  const complete = () => {
    completed.current = true;
    clearInterval(timers.current.buzz);
    haptics.success();
    setHolding(false);
    scale.value = withTiming(1, { duration: 200 });
    onComplete();
  };

  const pressIn = () => {
    if (completed.current) return;
    downAt.current = Date.now();
    setTip(false);
    setHolding(true);
    ring.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear });
    flood.value = withTiming(1, { duration: HOLD_MS, easing: FLOOD_EASING });
    scale.value = withTiming(1.12, { duration: 200 });
    let step = 0;
    haptics.holdTick(step++);
    timers.current.buzz = setInterval(() => haptics.holdTick(step++), 250);
    timers.current.done = setTimeout(complete, HOLD_MS);
  };

  const pressOut = () => {
    if (completed.current) return;
    clearTimeout(timers.current.done);
    clearInterval(timers.current.buzz);
    setHolding(false);
    ring.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) });
    flood.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.quad) });
    scale.value = withTiming(1, { duration: 200 });
    if (Date.now() - downAt.current < SHORT_TAP_MS) showTip();
  };

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - ring.value) }));
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View>
      <Pressable
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={copy.session.stopLabel}
        accessibilityHint={copy.session.stopHint}
        // Screen readers can't hold: their "activate" ends it directly.
        accessibilityActions={[{ name: 'activate', label: copy.session.stopLabel }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && !completed.current && complete()}
      >
        <Animated.View style={[styles.button, buttonStyle]}>
          <Svg width={SIZE} height={SIZE} style={styles.ring}>
            <AnimatedCircle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={color.green}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              animatedProps={ringProps}
            />
          </Svg>
          <View style={[styles.square, holding && styles.squareHolding]} />
        </Animated.View>
      </Pressable>
      {tip && (
        // A wide transparent box so the tip sizes to its text instead of the 52 px button.
        <View style={styles.tipBox} pointerEvents="none">
          <View style={styles.tip}>
            <View style={styles.tipArrow} />
            <Text style={styles.tipText} numberOfLines={1}>
              {copy.session.holdToEnd}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  square: { width: 16, height: 16, borderRadius: 4, backgroundColor: color.text },
  squareHolding: { backgroundColor: color.green, transform: [{ scale: 0.85 }] },
  tipBox: { position: 'absolute', right: 0, top: SIZE + 10, width: 240, alignItems: 'flex-end', zIndex: 10 },
  tip: { backgroundColor: color.text, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  tipArrow: { position: 'absolute', right: 21, top: -5, width: 10, height: 10, backgroundColor: color.text, borderRadius: 2, transform: [{ rotate: '45deg' }] },
  tipText: { fontSize: 13, fontWeight: '600', color: color.ink },
});
