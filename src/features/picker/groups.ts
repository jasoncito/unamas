import type { IsoDate } from '@/domain/types';

/** Base muscle groups (CLAUDE.md §8), stored lowercase as in the data. */
export const BASE_MUSCLE_GROUPS = [
  'pecho',
  'espalda',
  'bíceps',
  'tríceps',
  'hombro',
  'pierna',
  'glúteo',
  'pantorrilla',
  'core',
  'cardio',
] as const;

export interface MuscleGroupRow {
  name: string;
  lastDate: IsoDate | null;
}

/**
 * Screen 1 order: longest since trained first, never trained last. Ties keep the base order.
 * Groups found in the data but not in the base list (custom ones) are included too.
 */
export function orderMuscleGroups(lastDates: ReadonlyMap<string, IsoDate>): MuscleGroupRow[] {
  const names = [...BASE_MUSCLE_GROUPS, ...[...lastDates.keys()].filter((g) => !isBase(g)).sort()];
  const rows = names.map((name, i) => ({ name, lastDate: lastDates.get(name) ?? null, i }));
  rows.sort((a, b) => {
    if (a.lastDate === b.lastDate) return a.i - b.i;
    if (a.lastDate === null) return 1;
    if (b.lastDate === null) return -1;
    return a.lastDate < b.lastDate ? -1 : 1;
  });
  return rows.map(({ name, lastDate }) => ({ name, lastDate }));
}

function isBase(g: string): boolean {
  return (BASE_MUSCLE_GROUPS as readonly string[]).includes(g);
}
