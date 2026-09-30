import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { copy } from '@/ui/copy';
import { color, space, type } from '@/ui/tokens';

// Pantalla 1 · elegir músculo. Placeholder de M0; la lista llega en M4.
export default function PickerScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View>
        <Text style={styles.title}>{copy.picker.title}</Text>
        <Text style={styles.subtitle}>{copy.picker.subtitle}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.screenX },
  title: {
    color: color.text,
    fontSize: type.title.size,
    fontWeight: type.title.weight,
    letterSpacing: type.title.size * type.title.tracking,
  },
  subtitle: { color: color.muted, fontSize: type.label.size, fontWeight: type.label.weight, marginTop: 6 },
});
