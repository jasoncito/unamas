import { useEffect, useRef, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { formatKg } from '@/domain/format';

/**
 * The big number rolls from the previous value to the new one (ease-out cubic) instead of jumping,
 * rounding to `quantum` on the way (0.25 on the bar, a plate on the stack, 1 kg on the rack). Reduce
 * Motion: it just changes.
 */
export function RollingNumber({ value, durationMs, quantum, style }: { value: number; durationMs: number; quantum: number; style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const current = useRef(value);

  useEffect(() => {
    if (reduced) {
      current.current = value;
      setShown(value);
      return;
    }
    from.current = current.current;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / durationMs);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from.current + (value - from.current) * e;
      current.current = k < 1 ? v : value;
      setShown(k < 1 ? Math.round(v / quantum) * quantum : value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, quantum, reduced]);

  return <Text style={style}>{formatKg(shown)}</Text>;
}
