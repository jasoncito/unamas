import { isBaseGroup, MUSCLE_GROUPS, SPANISH_TO_KEY } from '../../../shared/muscleGroups';

import { normalizeName } from '@/domain/names';
import type { IsoDate } from '@/domain/types';
import { copy } from '@/ui/copy';

/** Base muscle groups (CLAUDE.md §8), as keys; their labels are in copy.muscleGroups. */
export const BASE_MUSCLE_GROUPS = MUSCLE_GROUPS;

/** What screen 1 and the headers show for a group: its label, or a custom one as it was typed. */
export function muscleGroupLabel(group: string): string {
  if (isBaseGroup(group)) return copy.muscleGroups[group];
  return group.charAt(0).toUpperCase() + group.slice(1);
}

/** "Otro…": a base group's name ("pecho", "Tríceps") becomes its key; anything else stays as typed, lowercase. */
export function groupFromTyped(raw: string): string {
  const typed = normalizeName(raw);
  if (!typed) return '';
  for (const key of MUSCLE_GROUPS) if (normalizeName(copy.muscleGroups[key]) === typed || key === typed) return key;
  const legacy = Object.entries(SPANISH_TO_KEY).find(([name]) => normalizeName(name) === typed);
  return legacy ? legacy[1] : raw.trim().toLowerCase();
}

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
  return isBaseGroup(g);
}
