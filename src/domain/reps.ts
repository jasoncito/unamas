import { EXTEND_REPS, isNextLoadAbsorbable } from './engine';
import type { ExerciseConfig } from './types';

// Screens 3–4 of the per-exercise flow: the range to aim for, the reps prefilled, and what they
// say they did ("3 de 8 y una de 7") turned into one number per set, without the AI.

/**
 * "Apunta a 6–10 por serie": the engine's range for that load. The top is the effective one (§3.3):
 * extended when the next load up wouldn't be absorbable from this one.
 */
export function aimRange(config: ExerciseConfig, loadKg: number): [number, number] {
  const top = isNextLoadAbsorbable(loadKg, config) ? config.repTop : config.repTop + EXTEND_REPS;
  return [config.repFloor, top];
}

/**
 * Screen 4's rows before they touch anything, as many as last time's sets (decided with Jason): same
 * load (or less) → last time +1 per set, up to the top; more load → the floor of the range. Without a
 * last time, three sets at the floor.
 */
export function prefillReps(config: ExerciseConfig, loadKg: number, last: { loadKg: number; reps: readonly number[] } | null): number[] {
  const [floor, top] = aimRange(config, loadKg);
  if (!last || last.reps.length === 0) return [floor, floor, floor];
  if (loadKg > last.loadKg + 1e-6) return last.reps.map(() => floor);
  return last.reps.map((r) => Math.min(top, r + 1));
}

/** Reps one set can have: 1 to 99. */
export const MIN_REPS = 1;
export const MAX_REPS = 99;

const WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  treinta: 30,
};

/** Dictation writes "tres de ocho" as often as "3 de 8": words become digits, accents and case go. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[a-z]+/g, (w) => (w in WORDS ? String(WORDS[w]) : w));
}

const valid = (n: number) => Number.isInteger(n) && n >= MIN_REPS && n <= MAX_REPS;

/**
 * What they say they did, as one number per set, or null if it isn't one of the common shapes (then
 * /parse is asked). Shapes, joined by "y" or commas:
 * - "N de M", "NxM", "N por M", "N series de M" → N sets of M
 * - "una de M", "la última de M", "otra de M" → one set of M
 * - a plain list, "8 8 7" or "8, 8, 7" → one set each
 * Anything else in the phrase (a load, "reps", "fácil"…) → null: better to ask than to guess.
 */
export function parseReps(text: string): number[] | null {
  const s = normalize(text)
    .replace(/\b(repeticiones|repes|reps|rep|series|serie|sets|set)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  // A plain list: only numbers, spaces and commas.
  if (/^\d+([ ,]+\d+)*$/.test(s)) {
    const reps = s.split(/[ ,]+/).map(Number);
    return reps.every(valid) && reps.length <= 20 ? reps : null;
  }

  const out: number[] = [];
  for (const raw of s.split(/\s*(?:,|\by\b|\+)\s*/)) {
    const part = raw.trim();
    if (!part) continue;
    const many = /^(\d+)\s*(?:de|x|×|por)\s*(\d+)$/.exec(part);
    const one = /^(?:la ultima|ultima|otra|la otra|1)\s*(?:de|x|×|por|con)\s*(\d+)$/.exec(part);
    if (many) {
      const [sets, reps] = [Number(many[1]), Number(many[2])];
      if (sets < 1 || sets > 20 || !valid(reps)) return null;
      out.push(...Array<number>(sets).fill(reps));
    } else if (one) {
      const reps = Number(one[1]);
      if (!valid(reps)) return null;
      out.push(reps);
    } else {
      return null;
    }
  }
  return out.length > 0 && out.length <= 20 ? out : null;
}
