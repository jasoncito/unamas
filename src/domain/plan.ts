import { nextTarget } from './engine';
import type { ExerciseConfig, Exposure, IsoDate } from './types';

/** One row of screen 2's "hoy te toca" (CLAUDE.md §8, design/meta.html). */
export interface PlanRow {
  exerciseId: string;
  loadKg: number;
  reps: number[];
  /** The load goes up: PESO in green with "antes". */
  loadUp: boolean;
  /** Same load, more reps: SERIES in green with "antes". */
  setsUp: boolean;
  before: { loadKg: number; reps: number[] };
}

/** Today's target for an exercise and what goes up versus its last time. Null without history. */
export function planRow(
  exercise: ExerciseConfig & { id: string },
  history: readonly Exposure[],
  today: IsoDate,
): PlanRow | null {
  const target = nextTarget(history, exercise, today);
  const last = history.at(-1);
  if (!target || !last) return null;
  return {
    exerciseId: exercise.id,
    loadKg: target.loadKg,
    reps: target.reps,
    loadUp: target.loadKg > last.loadKg,
    setsUp: target.loadKg === last.loadKg && sum(target.reps) > sum(last.reps),
    before: { loadKg: last.loadKg, reps: last.reps },
  };
}

/**
 * How someone would say a target, for the input's placeholder: "press de hombros, 24 kg, 4 de 9".
 * `spokenName` is how they call the exercise (its first alias, or the name in lowercase).
 */
export function dictationOf(spokenName: string, loadKg: number, reps: readonly number[]): string {
  const sets = reps.every((r) => r === reps[0]) ? `${reps.length} de ${reps[0]}` : reps.join(', ');
  return `${spokenName}, ${Math.round(loadKg * 1000) / 1000} kg, ${sets}`;
}

/** ["hombro", "tríceps"] → "Hombro y tríceps"; three or more: "Pecho, espalda y bíceps". */
export function groupsLabel(groups: readonly string[]): string {
  if (groups.length === 0) return '';
  const joined = groups.length === 1 ? groups[0] : `${groups.slice(0, -1).join(', ')} y ${groups.at(-1)}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
