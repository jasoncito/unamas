import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutUp } from 'react-native-reanimated';

import type { FeedbackLine } from '@/features/session/templates';

import { font } from '../text';
import { color, radius } from '../tokens';
import { CheckDot } from './CheckDot';

interface Props {
  text: string;
  /** Still waiting for /parse: a subtle, dimmed bubble. */
  pending: boolean;
  feedback: FeedbackLine | null;
}

/** Screen 4: what they sent rises from the input; "Anotado · …" appears under it (CLAUDE.md §8). */
export function Bubble({ text, pending, feedback }: Props) {
  return (
    <Animated.View entering={FadeInDown.duration(450)} exiting={FadeOutUp.duration(350)} style={styles.wrap}>
      <View style={[styles.bubble, pending && styles.pending]} accessibilityState={{ busy: pending }}>
        <Text style={styles.text}>{text}</Text>
      </View>
      {feedback && (
        <Animated.View entering={FadeIn.delay(250).duration(300)} style={styles.feedback}>
          {feedback.tone === 'up' && <CheckDot />}
          <Text style={[styles.line, feedback.tone === 'up' && styles.up]}>{feedback.text}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 8 },
  bubble: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: radius.bubble,
    paddingVertical: 11,
    paddingHorizontal: 15,
    maxWidth: '85%',
  },
  pending: { opacity: 0.55 },
  text: { ...font('body'), color: color.text, lineHeight: 21 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  line: { fontSize: 14, fontWeight: '600', color: color.muted },
  up: { color: color.green },
});
