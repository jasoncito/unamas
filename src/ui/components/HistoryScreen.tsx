import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { copy } from '../copy';
import { font } from '../text';
import { color, space } from '../tokens';
import { FlowHeader } from './flow/FlowHeader';

/** The history's frame: "‹ Volver", a title, and its content (a list, a session, an exercise). */
export function HistoryScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <FlowHeader backLabel={copy.history.back} name={title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.body}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { flex: 1, paddingHorizontal: space.screenX, paddingTop: 12 },
  subtitle: { ...font('label'), color: color.muted, marginTop: 4 },
  body: { flex: 1 },
});
