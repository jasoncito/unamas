/** An entry as the engine's history needs it: which session it belongs to, and its numbers. */
export interface SessionSet {
  sessionId: string;
  loadKg: number;
  reps: readonly number[];
}

/**
 * One exposure per session (PROGRESSION.md §4): the best entry of each — more load; at the same load,
 * more total reps; if they tie, the later one. Keeps the order of the input (oldest first).
 */
export function bestOfEachSession<T extends SessionSet>(entries: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const e of entries) {
    const current = best.get(e.sessionId);
    if (!current || !isBetter(current, e)) best.set(e.sessionId, e);
  }
  const kept = new Set(best.values());
  return entries.filter((e) => kept.has(e));
}

/** `a` beats `b`: more load, or the same load and more total reps. */
function isBetter(a: SessionSet, b: SessionSet): boolean {
  if (a.loadKg !== b.loadKg) return a.loadKg > b.loadKg;
  return sum(a.reps) > sum(b.reps);
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
