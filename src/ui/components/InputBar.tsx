import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { copy } from '../copy';
import { font } from '../text';
import { color, radius } from '../tokens';
import { CameraIcon, MicIcon, SendIcon } from './Icons';

interface Props {
  value: string;
  placeholder: string;
  onChangeText(text: string): void;
  onSend?(): void;
  /** The mic: start dictating, or stop. */
  onMic?(): void;
  /** Dictation is on: the mic shows it, and tapping it stops (never sends). */
  listening?: boolean;
  /** The camera, always visible next to the mic (design/photo.html). Without it, no camera. */
  onCamera?(): void;
  /** The attached photo's uri: a thumbnail with × inside the input. */
  photo?: string | null;
  onRemovePhoto?(): void;
  /** Opens the keyboard on mount (screen 2). Default true. */
  autoFocus?: boolean;
}

/**
 * The input with the camera and the mic inside; with text or a photo, the mic becomes the green send
 * button (CLAUDE.md §8, design/photo.html).
 */
export function InputBar(p: Props) {
  const canSend = p.value.trim().length > 0 || !!p.photo;
  return (
    <View style={[styles.card, p.photo && styles.withPhoto]}>
      {p.photo && (
        <View style={styles.thumbWrap}>
          <Image source={{ uri: p.photo }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
          <Pressable onPress={p.onRemovePhoto} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel={copy.session.removePhoto}>
            <Text style={styles.removeText}>×</Text>
          </Pressable>
        </View>
      )}
      <TextInput
        style={styles.input}
        value={p.value}
        onChangeText={p.onChangeText}
        placeholder={p.listening ? copy.session.listening : p.placeholder}
        placeholderTextColor={color.muted}
        selectionColor={color.green}
        autoFocus={p.autoFocus ?? true}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="send"
        onSubmitEditing={p.onSend}
        multiline={!!p.photo}
        submitBehavior="submit"
      />
      {p.onCamera && (
        <Pressable onPress={p.onCamera} style={styles.button} accessibilityRole="button" accessibilityLabel={copy.session.camera}>
          <CameraIcon color={color.text} />
        </Pressable>
      )}
      {p.listening ? (
        // Listening: the mic in green; tapping it only stops (the text stays to review).
        <Pressable onPress={p.onMic} style={[styles.button, styles.send]} accessibilityRole="button" accessibilityLabel={copy.session.stopListening}>
          <MicIcon color={color.ink} size={20} />
        </Pressable>
      ) : canSend ? (
        <Pressable onPress={p.onSend} style={[styles.button, styles.send]} accessibilityRole="button" accessibilityLabel={copy.session.send}>
          <SendIcon color={color.ink} />
        </Pressable>
      ) : (
        <Pressable onPress={p.onMic} style={styles.button} accessibilityRole="button" accessibilityLabel={copy.session.mic}>
          <MicIcon color={color.text} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.input,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  withPhoto: { alignItems: 'flex-end', paddingLeft: 10 },
  thumbWrap: { width: 56, height: 56 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: color.raised },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: color.ink, fontSize: 13, fontWeight: '800', lineHeight: 15 },
  input: { ...font('input'), color: color.text, flex: 1, paddingVertical: 4 },
  button: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  send: { backgroundColor: color.green },
});
