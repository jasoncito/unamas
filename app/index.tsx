import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatShortDate } from '@/domain/format';
import { useMuscleGroups } from '@/features/picker/useMuscleGroups';
import { copy } from '@/ui/copy';
import { color, space, type } from '@/ui/tokens';

// Pantalla 1 · elegir músculo. M2: lista con las fechas reales; la selección llega en M4.
export default function PickerScreen() {
  const groups = useMuscleGroups();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{copy.picker.title}</Text>
        <Text style={styles.subtitle}>{copy.picker.subtitle}</Text>
        <View style={styles.list}>
          {groups?.map((g) => (
            <View key={g.name} style={styles.row}>
              <Text style={styles.muscle}>{capitalize(g.name)}</Text>
              <Text style={styles.date}>{g.lastDate ? formatShortDate(g.lastDate) : copy.picker.never}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingBottom: 40 },
  title: {
    color: color.text,
    fontSize: type.title.size,
    fontWeight: type.title.weight,
    letterSpacing: type.title.size * type.title.tracking,
  },
  subtitle: { color: color.muted, fontSize: type.label.size, fontWeight: type.label.weight, marginTop: 6 },
  list: { marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: space.rowY,
  },
  muscle: {
    color: color.text,
    fontSize: type.muscle.size,
    fontWeight: type.muscle.weight,
    letterSpacing: type.muscle.size * type.muscle.tracking,
  },
  date: {
    color: color.muted,
    fontSize: type.label.size,
    fontWeight: type.label.weight,
    fontVariant: ['tabular-nums'],
  },
});
