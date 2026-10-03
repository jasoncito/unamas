import { formatKg, formatSets } from '@/domain/format';
import type { LoadBasis } from '@/domain/types';

import { copy } from '../../copy';
import type { DeltaLine } from './logic';

/** "+2.5 kg · apunta a 6 o más", "igual que el 27 · apunta a 4×11", "−2 kg que el 27". */
export function deltaText(line: DeltaLine): string {
  switch (line.kind) {
    case 'up':
      return copy.selector.up(formatKg(line.diffKg), line.repFloor);
    case 'same':
      return copy.selector.same(line.day, line.target ? formatSets(line.target) : null);
    case 'down':
      return copy.selector.down(formatKg(line.diffKg), line.day);
  }
}

/** "kg por lado", "kg", "kg c/u". */
export function unitFor(basis: LoadBasis): string {
  const u = copy.selector.unit;
  return basis === 'per_side' ? u.bar : basis === 'stack' ? u.stack : basis === 'per_dumbbell' ? u.rack_per_dumbbell : u.rack_total;
}

/** The day as the line says it: "27", or "30 ago" in another month than today. */
export function dayOf(date: string, today: string): string {
  const [, m, d] = date.split('-').map(Number);
  if (date.slice(0, 7) === today.slice(0, 7)) return String(d);
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d} ${MONTHS[m - 1]}`;
}
