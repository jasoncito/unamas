import type { TextStyle } from 'react-native';

import { type } from './tokens';

/** A §9 type token as a React Native text style (tracking is in em). */
export function font(token: keyof typeof type): TextStyle {
  const t = type[token] as { size: number; weight: string; tracking?: number; uppercase?: boolean };
  return {
    fontSize: t.size,
    fontWeight: t.weight as TextStyle['fontWeight'],
    ...(t.tracking !== undefined && { letterSpacing: t.size * t.tracking }),
    ...(t.uppercase && { textTransform: 'uppercase' }),
  };
}

/** Numbers always tabular (CLAUDE.md §9). */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
