import { StyleSheet, View } from 'react-native';

import { color } from '../tokens';
import { CheckIcon } from './Icons';

/** 18 px green circle with the check in ink (design/flow.html `.ok`); `muted`: surface with a light check. */
export function CheckDot({ muted = false }: { muted?: boolean }) {
  return (
    <View style={[styles.dot, muted && styles.muted]}>
      <CheckIcon color={muted ? color.text : color.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' },
  muted: { backgroundColor: color.surface },
});
