export type ExerciseKind = 'compound_heavy' | 'compound' | 'isolation' | 'calf';

export type LoadBasis = 'per_side' | 'per_dumbbell' | 'total' | 'stack';

/** Calendar date as 'YYYY-MM-DD'. The caller converts timestamps to the user's local date. */
export type IsoDate = string;

/** Effort the user volunteered ("fácil", "al fallo"). Never asked for (PROGRESSION.md §6). */
export type Effort = 'easy' | 'failure';

/** One time the user did an exercise. `loadKg` is as the user states it (per side, per dumbbell…). */
export interface Exposure {
  date: IsoDate;
  loadKg: number;
  /** One item per set, e.g. [11, 11, 11, 9]. */
  reps: number[];
  effort?: Effort;
}

/** What the engine needs to know about an exercise (subset of the `exercise` row). */
export interface ExerciseConfig {
  kind: ExerciseKind;
  repFloor: number;
  repTop: number;
  stepKg: number;
}
