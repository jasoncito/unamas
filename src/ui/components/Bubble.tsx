import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutUp } from 'react-native-reanimated';

import type { FeedbackLine } from '@/features/session/templates';

import { copy } from '../copy';
import { font } from '../text';
import { color, radius } from '../tokens';
import { CheckDot } from './CheckDot';

interface Props {
  text: string;
  /** The machine's photo sent with it: a thumbnail on top (design/photo.html). */
  image?: string | null;
  /** Still waiting for /parse: a subtle, dimmed bubble. */
  pending: boolean;
  feedback: FeedbackLine | null;
  /** "Deshacer" at the end of "Anotado", while it's on screen (decided with Jason). */
  onUndo?(): void;
}

/** Screen 4: what they sent rises from the input; "Anotado · …" appears under it (CLAUDE.md §8). */
export function Bubble({ text, image, pending, feedback, onUndo }: Props) {
  return (
    <Animated.View entering={FadeInDown.duration(450)} exiting={FadeOutUp.duration(350)} style={styles.wrap}>
      <View style={[styles.bubble, image && styles.withImage, pending && styles.pending]} accessibilityState={{ busy: pending }}>
        {image && <Image source={{ uri: image }} style={styles.image} contentFit="cover" accessibilityIgnoresInvertColors />}
        {!!text && <Text style={[styles.text, image && styles.textUnderImage]}>{text}</Text>}
      </View>
      {feedback && (
        <Animated.View entering={FadeIn.delay(250).duration(300)} style={styles.feedback}>
          {/* Green only when it went up; otherwise the same check in gray (design/photo.html). */}
          <CheckDot muted={feedback.tone !== 'up'} />
          <Text style={[styles.line, feedback.tone === 'up' && styles.up]}>{feedback.text}</Text>
          {onUndo && (
            <Pressable onPress={onUndo} hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }} accessibilityRole="button">
              {/* Never green: green is progress, not a button. */}
              <Text style={styles.undo}>{copy.session.undo}</Text>
            </Pressable>
          )}
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
  withImage: { width: 210, padding: 6 },
  image: { width: '100%', height: 150, borderRadius: 13, backgroundColor: color.raised },
  textUnderImage: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },
  pending: { opacity: 0.55 },
  text: { ...font('body'), color: color.text, lineHeight: 21 },
  feedback: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', columnGap: 7, rowGap: 4, maxWidth: '100%' },
  line: { fontSize: 14, fontWeight: '600', color: color.muted },
  up: { color: color.green },
  undo: { fontSize: 14, fontWeight: '600', color: color.text, textDecorationLine: 'underline' },
});
