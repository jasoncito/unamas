import { useId } from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { color, metal } from '../../tokens';

/** Neutral metal for what repeats last time; green only for what goes beyond it; dim for what isn't loaded. */
export type Finish = 'metal' | 'green' | 'dim';

const STOPS: Record<Finish, string[]> = {
  metal: [metal.dark, metal.light, metal.shine, metal.light, metal.dark],
  green: [metal.greenDark, color.green, metal.greenShine, color.green, metal.greenDark],
  dim: [metal.dim, metal.dimLight, metal.dim],
};

/** A rounded rect with a metal sheen, across (`horizontal`) or down. */
export function MetalRect({
  width,
  height,
  radius,
  finish,
  horizontal = true,
}: {
  width: number;
  height: number;
  radius: number;
  finish: Finish;
  horizontal?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const stops = STOPS[finish];
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
          {stops.map((c, i) => (
            <Stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={radius} fill={`url(#${id})`} />
    </Svg>
  );
}
