import { StyleSheet, View } from 'react-native';

import { color } from '../tokens';
import { CheckIcon } from './Icons';

/** 18 px green circle with the check in ink (design/flow.html `.ok`). */
export function CheckDot() {
  return (
    <View style={styles.dot}>
      <CheckIcon color={color.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' },
});
