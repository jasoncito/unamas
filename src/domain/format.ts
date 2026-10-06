import type { LoadBasis } from './types';

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

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-09-17' → "17 sep" */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "24 kg", or "20 kg/lado" for loads said per side. */
export function formatLoad(loadKg: number, basis: LoadBasis): string {
  return `${formatKg(loadKg)} kg${basis === 'per_side' ? '/lado' : ''}`;
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** '2026-09-28' → "Lunes 28" (screen 7's header). */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

/** How long a session took: "58 min", "1 h 05 min"; never "0 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** The session bar's stopwatch: "4:07", "42:10", "1:02:05". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** '2026-09-27' → "Sábado 27 sep" (the history's dates: they span months). */
export function formatLongDate(date: string): string {
  return `${formatDayLabel(date)} ${MONTHS[Number(date.split('-')[1]) - 1]}`;
}
