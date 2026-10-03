import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { formatKg } from '@/domain/format';
import { haptics } from '@/services/haptics';

import { copy } from '../../copy';
import { tabular } from '../../text';
import { color, metal } from '../../tokens';
import { MetalRect, type Finish } from './Metal';

interface Props {
  width: number;
  height: number;
  /** The rack's weights, lightest first. */
  values: readonly number[];
  /** Selected index; changing it from outside ("↺ sugerido") scrolls there. */
  index: number;
  lastKg: number | null;
  lastTag: string | null;
  /** How far the rack bleeds past the zone on each side (the screen gutter): it scrolls edge to edge. */
  bleed: number;
  onChange(index: number): void;
}

/**
 * Dumbbells and per-unit loads: a horizontal rack, native scroll snapping to each one (design/selector.html).
 * The one in the middle rises and grows; a selection haptic each time it changes; tapping one centers it.
 */
export function DumbbellRack({ width, height, values, index, lastKg, lastTag, bleed, onChange }: Props) {
  const reduced = useReducedMotion();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const fullW = width + bleed * 2;
  const itemW = Math.round(Math.min(96, Math.max(64, height * 0.34)) / 8) * 8;
  const side = (fullW - itemW) / 2;
  const x = useSharedValue(index * itemW);
  const center = useSharedValue(index);
  const [selected, setSelected] = useState(index);

  const select = (i: number) => {
    setSelected(i);
    haptics.select();
    onChange(i);
  };
  const onScroll = useAnimatedScrollHandler((e) => {
    x.value = e.contentOffset.x;
    const i = Math.min(values.length - 1, Math.max(0, Math.round(e.contentOffset.x / itemW)));
    if (i !== center.value) {
      center.value = i;
      runOnJS(select)(i);
    }
  });

  const scrollTo = (i: number, animated: boolean) => ref.current?.scrollTo({ x: i * itemW, y: 0, animated: animated && !reduced });
  // From outside ("↺ sugerido"): scroll there.
  useEffect(() => {
    if (center.value === index) return;
    scrollTo(index, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Room for the middle one to grow (× 1.18) and rise without its date tag leaving the zone.
  const maxH = Math.max(24, Math.min(height * 0.38, height - 120));
  return (
    <View style={{ width, height }}>
      <Animated.ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemW}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentOffset={{ x: index * itemW, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: side }}
        style={{ marginHorizontal: -bleed, width: fullW, height }}
      >
        {values.map((kg, i) => (
          <Dumbbell
            key={kg}
            i={i}
            kg={kg}
            x={x}
            itemW={itemW}
            height={height}
            maxH={maxH}
            maxKg={values[values.length - 1]}
            finish={i !== selected ? 'dim' : lastKg !== null && kg > lastKg + 1e-6 ? 'green' : 'metal'}
            selected={i === selected}
            tag={lastKg !== null && Math.abs(kg - lastKg) < 1e-6 ? lastTag : null}
            onPress={() => scrollTo(i, true)}
          />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

function Dumbbell(p: {
  i: number;
  kg: number;
  x: SharedValue<number>;
  itemW: number;
  height: number;
  maxH: number;
  maxKg: number;
  finish: Finish;
  selected: boolean;
  tag: string | null;
  onPress(): void;
}) {
  const style = useAnimatedStyle(() => {
    const k = Math.max(0, 1 - Math.abs(p.i * p.itemW - p.x.value) / p.itemW);
    return { transform: [{ translateY: -p.height * 0.05 * k }, { scale: 0.82 + 0.36 * k }], opacity: 0.4 + 0.6 * k };
  });
  // Heavier dumbbells have bigger heads.
  const r = p.kg / p.maxKg;
  const headH = p.maxH * (0.5 + 0.5 * r);
  const headW = p.itemW * (0.16 + 0.1 * r);
  const handleW = p.itemW * 0.22;
  return (
    <Pressable onPress={p.onPress} style={{ width: p.itemW, height: p.height, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={copy.selector.choose(formatKg(p.kg))}>
      <Animated.View style={[styles.item, style]}>
        <View style={styles.tagRow}>{p.tag && <Text style={styles.tag}>{p.tag}</Text>}</View>
        <View style={[styles.bell, { height: p.maxH }]}>
          <MetalRect width={headW} height={headH} radius={Math.min(7, headW / 3)} finish={p.finish} />
          <View style={{ width: handleW, height: Math.max(6, p.maxH * 0.08), backgroundColor: metal.dimLight }} />
          <MetalRect width={headW} height={headH} radius={Math.min(7, headW / 3)} finish={p.finish} />
        </View>
        <Text style={[styles.label, p.selected && styles.labelOn]}>{formatKg(p.kg)}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 8 },
  tagRow: { height: 24, justifyContent: 'center' },
  tag: { fontSize: 11, fontWeight: '800', color: color.text, backgroundColor: color.raised, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  bell: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 15, fontWeight: '800', color: color.muted, ...tabular },
  labelOn: { color: color.text },
});
