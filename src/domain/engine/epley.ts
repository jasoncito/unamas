/** Estimated 1RM (Epley). Only used to compare exposures, never shown to the user. */
export function epley(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30);
}
