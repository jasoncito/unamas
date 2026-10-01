import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { SessionSummary } from '@/features/session/controller';
import { tallyLines } from '@/features/session/templates';

import { copy } from '../copy';
import { font } from '../text';
import { color } from '../tokens';

/** Mockup's stagger: 0, .12, .24, .36, then .5 s for the minutes. */
const STAGGER_MS = [0, 120, 240, 360, 480, 600];

/**
 * Screen 6's green: rises from the bottom while the stop is held (`flood` 0 → 1), drains if let go.
 * Once the session ends it holds the count in ink, in steps, before receding to the summary.
 */
export function Flood({ flood, summary }: { flood: SharedValue<number>; summary: SessionSummary | null }) {
  const style = useAnimatedStyle(() => ({ height: `${flood.value * 100}%` }));
  const lines = summary ? tallyLines(summary.tally).map((l) => l.text) : [];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.green, style]} />
      {summary && (
        <Animated.View style={styles.text} exiting={FadeOut.duration(200)} accessibilityLiveRegion="polite">
          <Animated.Text entering={FadeInDown.duration(450).delay(STAGGER_MS[0])} style={styles.kicker}>
            {copy.session.ended}
          </Animated.Text>
          {lines.map((text, i) => (
            <Animated.Text key={text} entering={FadeInDown.duration(450).delay(STAGGER_MS[Math.min(i + 1, 4)])} style={styles.line}>
              {text}
            </Animated.Text>
          ))}
          <Animated.Text entering={FadeInDown.duration(450).delay(STAGGER_MS[5])} style={[styles.kicker, styles.minutes]}>
            {summary.duration}
          </Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  green: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.green },
  text: { position: 'absolute', left: 24, right: 24, top: 0, bottom: 0, justifyContent: 'center' },
  kicker: { fontSize: 15, fontWeight: '700', color: color.ink },
  line: { ...font('flood'), color: color.ink, lineHeight: 48 },
  minutes: { marginTop: 14 },
});
