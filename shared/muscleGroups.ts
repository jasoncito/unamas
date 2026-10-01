// Base muscle groups as language-neutral keys (decided with Jason, 1 oct 2026), shared by the app and
// the Worker. The labels live with the app's copy. Custom groups ("Otro…") keep what was typed.

export const MUSCLE_GROUPS = ['chest', 'back', 'biceps', 'triceps', 'shoulders', 'legs', 'glutes', 'calves', 'core', 'cardio'] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** The Spanish names the data used before the keys, to their key (migrations and the seed). */
export const SPANISH_TO_KEY: Readonly<Record<string, MuscleGroup>> = {
  pecho: 'chest',
  espalda: 'back',
  'bíceps': 'biceps',
  'tríceps': 'triceps',
  hombro: 'shoulders',
  pierna: 'legs',
  'glúteo': 'glutes',
  pantorrilla: 'calves',
  core: 'core',
  cardio: 'cardio',
};

export function isBaseGroup(g: string): g is MuscleGroup {
  return (MUSCLE_GROUPS as readonly string[]).includes(g);
}
