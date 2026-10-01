import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { copy } from '../copy';
import { font } from '../text';
import { color, radius } from '../tokens';
import { MicIcon, SendIcon } from './Icons';

interface Props {
  value: string;
  placeholder: string;
  onChangeText(text: string): void;
  /** Wired in M5 (sending) and M7 (voice). */
  onSend?(): void;
  onMic?(): void;
  /** Opens the keyboard on mount (screen 2). Default true. */
  autoFocus?: boolean;
}

/** The input with the mic inside; with text, the mic becomes the green send button (CLAUDE.md §8). */
export function InputBar({ value, placeholder, onChangeText, onSend, onMic, autoFocus = true }: Props) {
  const hasText = value.trim().length > 0;
  return (
    <View style={styles.card}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        selectionColor={color.green}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="send"
        onSubmitEditing={onSend}
        multiline={false}
      />
      {hasText ? (
        <Pressable onPress={onSend} style={[styles.button, styles.send]} accessibilityRole="button" accessibilityLabel={copy.session.send}>
          <SendIcon color={color.ink} />
        </Pressable>
      ) : (
        <Pressable onPress={onMic} style={styles.button} accessibilityRole="button" accessibilityLabel={copy.session.mic}>
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
  input: { ...font('input'), color: color.text, flex: 1, paddingVertical: 4 },
  button: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  send: { backgroundColor: color.green },
});
