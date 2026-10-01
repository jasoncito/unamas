import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionState } from '@/features/session/reducer';

import { copy } from '../copy';
import { font } from '../text';
import { color } from '../tokens';
import { AmbiguityPanel } from './AmbiguityPanel';
import { Bubble } from './Bubble';
import { InputBar } from './InputBar';

interface Props {
  state: SessionState;
  origin: { dayLabel: string; groupsLabel: string } | null;
  onChoose(exerciseId: string): void;
  onChangeText(text: string): void;
  onSend(text: string): void;
  onNotNow(): void;
}

/**
 * Screen 1, before picking groups: a message of a session already stopped turned out ambiguous when
 * it was retried. The answer goes to that session (decided with Jason).
 */
export function PastDoubt({ state, origin, onChoose, onChangeText, onSend, onNotNow }: Props) {
  const send = () => {
    if (!state.text.trim()) return;
    Keyboard.dismiss();
    onSend(state.text);
  };
  return (
    <View style={styles.wrap}>
      {origin && <Text style={styles.origin}>{copy.session.fromSession(origin.dayLabel, origin.groupsLabel)}</Text>}
      <View style={styles.flex} />
      {(state.phase === 'sending' || state.phase === 'feedback') && (
        <Bubble text={state.bubble} pending={state.phase === 'sending'} feedback={state.phase === 'feedback' ? state.feedback : null} />
      )}
      {state.phase === 'disambiguating' && (
        <>
          <AmbiguityPanel said={state.said} question={state.question} options={state.options} onChoose={onChoose} />
          <InputBar value={state.text} onChangeText={onChangeText} onSend={send} placeholder={copy.session.otherPlaceholder} autoFocus={false} />
          <Pressable onPress={onNotNow} hitSlop={10} style={styles.notNow} accessibilityRole="button">
            <Text style={styles.notNowText}>{copy.session.notNow}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 10 },
  flex: { flex: 1 },
  origin: { ...font('label'), color: color.muted },
  notNow: { alignSelf: 'center', paddingVertical: 6 },
  notNowText: { ...font('label'), color: color.muted },
});
