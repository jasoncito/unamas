// The weight selector's rules, pure: no React, no native modules (tested in logic.test.ts).
import type { LoadBasis } from '@/domain/types';

/** The tray, heaviest first (kg per side). */
export const PLATES = [20, 10, 5, 2.5, 1.25] as const;
export type Plate = (typeof PLATES)[number];

/** Heaviest dumbbell on the rack. */
export const MAX_DUMBBELL_KG = 50;

const EPS = 1e-6;
const round = (kg: number) => Math.round(kg * 1000) / 1000;

/** Which piece of equipment the selector looks like (CLAUDE.md, flujo por ejercicio). */
export type Equipment = 'bar' | 'stack' | 'rack';
export function equipmentFor(basis: LoadBasis): Equipment {
  return basis === 'per_side' ? 'bar' : basis === 'stack' ? 'stack' : 'rack';
}

/**
 * The plates for a per-side load, heaviest first, taking as many of each as fit (greedy): 32.5 →
 * 20 + 10 + 2.5. What can't be made with the tray is left out (it rounds down to the nearest load).
 */
export function greedyPlates(kgPerSide: number): Plate[] {
  const out: Plate[] = [];
  let left = round(kgPerSide);
  for (const p of PLATES) {
    while (left + EPS >= p) {
      out.push(p);
      left = round(left - p);
    }
  }
  return out;
}

export const sumPlates = (plates: readonly number[]) => round(plates.reduce((a, b) => a + b, 0));

/** Heaviest inside, lightest outside: how plates sit on the sleeve. */
export const sortPlates = <T extends number>(plates: readonly T[]): T[] => [...plates].sort((a, b) => b - a);

/**
 * Green on the bar (green = progress): only the plates beyond last time's configuration, as a
 * multiset difference (20+10 → 20+10+2.5: only the 2.5), and only if the total goes up. One flag per
 * plate, in the order given.
 */
export function greenPlates(plates: readonly number[], previous: readonly number[] | null): boolean[] {
  if (!previous) return plates.map(() => false);
  if (sumPlates(plates) <= sumPlates(previous) + EPS) return plates.map(() => false);
  const pool = [...previous];
  return plates.map((p) => {
    const i = pool.findIndex((q) => Math.abs(q - p) < EPS);
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
}

/**
 * The weight stack's plates: from one step up to max(last × 2, last + 10 steps), so there's always
 * room to go up. Without a last time, 20 steps.
 */
export function stackRange(stepKg: number, lastKg: number | null): number[] {
  const top = lastKg === null ? 20 * stepKg : Math.max(lastKg * 2, lastKg + 10 * stepKg);
  const n = Math.max(1, Math.round(top / stepKg));
  return Array.from({ length: n }, (_, i) => round((i + 1) * stepKg));
}

/** The dumbbell rack: one step to the next, up to MAX_DUMBBELL_KG. */
export function rackRange(stepKg: number): number[] {
  const n = Math.max(1, Math.floor(MAX_DUMBBELL_KG / stepKg + EPS));
  return Array.from({ length: n }, (_, i) => round((i + 1) * stepKg));
}

/** The index whose value is closest to `kg`. */
export function nearestIndex(values: readonly number[], kg: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - kg) < Math.abs(values[best] - kg)) best = i;
  return best;
}

/** The gap that opens under the pin, as a fraction of the pitch. */
export const STACK_GAP = 0.4;

/**
 * The stack's plate pitch: what fits (counting the gap under the pin), between 26 and 36 pt; at 26 and
 * still too tall, it scrolls (a window that follows the pin).
 */
export function stackPitch(height: number, plates: number): { pitch: number; gap: number; windowed: boolean } {
  const pitch = Math.min(36, Math.max(26, height / (plates + STACK_GAP)));
  const gap = Math.round(pitch * STACK_GAP);
  return { pitch, gap, windowed: pitch * plates + gap > height + EPS };
}

/** The line under the big number: compared with last time. */
export type DeltaLine =
  | { kind: 'up'; diffKg: number; repFloor: number }
  | { kind: 'same'; day: string; target: readonly number[] | null }
  | { kind: 'down'; diffKg: number; day: string };

/**
 * Up → "+X kg · apunta a <rep floor> o más"; same → "igual que el <día> · apunta a <target>" (the engine's
 * reps, when its suggestion is this load); down → "−X kg que el <día>". Null the first time (no last).
 */
export function deltaLine(
  value: number,
  last: { loadKg: number; day: string } | null,
  repFloor: number,
  suggestion: { loadKg: number; reps: readonly number[] } | null,
): DeltaLine | null {
  if (!last) return null;
  const diff = round(value - last.loadKg);
  if (diff > EPS) return { kind: 'up', diffKg: diff, repFloor };
  if (diff < -EPS) return { kind: 'down', diffKg: -diff, day: last.day };
  const target = suggestion && Math.abs(suggestion.loadKg - value) < EPS ? suggestion.reps : null;
  return { kind: 'same', day: last.day, target };
}
