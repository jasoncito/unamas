/** 7.5 → "7.5", 24 → "24", 13.75 → "13.75". */
export function formatKg(kg: number): string {
  return String(Math.round(kg * 1000) / 1000);
}

/** [12, 12, 12, 10] → "3×12 · 1×10" (higher reps first). */
export function formatSets(reps: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const r of reps) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([r, n]) => `${n}×${r}`)
    .join(' · ');
}

/** "24 kg · 4×8" */
export function formatExposure(loadKg: number, reps: readonly number[]): string {
  return `${formatKg(loadKg)} kg · ${formatSets(reps)}`;
}
