import { signed, type Delta } from '@/domain/delta';
import type { Target } from '@/domain/engine';
import { formatLoad, formatSets, formatShortDate } from '@/domain/format';
import type { NextTimeReason, SummaryItem, Tally } from '@/domain/summary';
import type { IsoDate } from '@/domain/types';

// Feedback phrases (CLAUDE.md §8, screen 4). The AI never writes these: they come from the numbers.

export interface FeedbackLine {
  text: string;
  /** Green only when it went up (CLAUDE.md §1: green means progress). */
  tone: 'up' | 'muted';
}

/**
 * "Anotado · +1 rep por serie vs. el 27"; the first time, with the name it got (design/photo.html):
 * "Anotado · Press de pecho en máquina · primera vez". Never green the first time: it isn't progress.
 */
export function feedbackLine(delta: Delta, previousDate: IsoDate | null, today: IsoDate, name: string): FeedbackLine {
  if (delta.kind === 'new' || !previousDate) return { text: name ? `Anotado · ${name} · primera vez` : 'Anotado · primera vez', tone: 'muted' };
  const when = `el ${sameMonth(previousDate, today) ? Number(previousDate.slice(8, 10)) : formatShortDate(previousDate)}`;
  const tone = delta.tone === 'up' ? 'up' : 'muted';
  switch (delta.kind) {
    case 'same':
      return { text: `Anotado · igual que ${when}`, tone };
    case 'load':
      return { text: `Anotado · ${signed(delta.diffKg)} kg vs. ${when}`, tone };
    case 'reps_per_set':
      return { text: `Anotado · ${signed(delta.diff)} ${reps(delta.diff)} por serie vs. ${when}`, tone };
    case 'reps_total':
      return { text: `Anotado · ${signed(delta.diff)} ${reps(delta.diff)} vs. ${when}`, tone };
  }
}

function reps(n: number): string {
  return Math.abs(n) === 1 ? 'rep' : 'reps';
}

function sameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

// ─── Screens 6–7 ────────────────────────────────────────────────────────────────────────────────

export interface TallyLine {
  text: string;
  /** "subieron" in green; "igual" in text; "nuevo" and "bajó" in muted (CLAUDE.md §8, screen 7). */
  tone: 'up' | 'text' | 'muted';
}

/**
 * "2 subieron", "1 igual", "1 bajó", "1 nuevo" — only what happened, in that order. Nothing logged
 * (only pending, or all deleted): "Nada anotado".
 */
export function tallyLines(t: Tally): TallyLine[] {
  const lines: TallyLine[] = [];
  if (t.up) lines.push({ text: t.up === 1 ? '1 subió' : `${t.up} subieron`, tone: 'up' });
  if (t.same) lines.push({ text: t.same === 1 ? '1 igual' : `${t.same} iguales`, tone: 'text' });
  if (t.down) lines.push({ text: t.down === 1 ? '1 bajó' : `${t.down} bajaron`, tone: 'muted' });
  if (t.new) lines.push({ text: t.new === 1 ? '1 nuevo' : `${t.new} nuevos`, tone: 'muted' });
  return lines.length > 0 ? lines : [{ text: 'Nada anotado', tone: 'muted' }];
}

/** "1 pendiente": saved without signal, not in the count until it's understood. */
export function pendingLine(n: number): string | null {
  if (n === 0) return null;
  return n === 1 ? '1 pendiente, se anota cuando haya señal' : `${n} pendientes, se anotan cuando haya señal`;
}

/**
 * "La próxima vez", in three parts so the action can go in bold:
 * "Press en máquina: llegaste a 4×12, el tope. " + "Sube a 22.5 kg/lado" + " y vuelve a 8."
 */
export function nextTimeLine(item: SummaryItem & { target: Target & { reason: NextTimeReason } }): {
  before: string;
  bold: string;
  after: string;
} {
  const { name, today, target, loadBasis, config } = item;
  switch (target.reason) {
    case 'add_load':
      return {
        before: `${name}: llegaste a ${formatSets(today.reps)}, el tope. `,
        bold: `Sube a ${formatLoad(target.loadKg, loadBasis)}`,
        after: ` y vuelve a ${target.reps[0]}.`,
      };
    case 'failed_load_jump':
      return {
        before: `${name}: con ${formatLoad(today.loadKg, loadBasis)} quedaste bajo ${config.repFloor}. `,
        bold: `Vuelve a ${formatLoad(target.loadKg, loadBasis)}`,
        after: ` y busca ${formatSets(target.reps)}.`,
      };
    case 'bad_day_repeat':
      return {
        before: `${name}: hoy costó más. `,
        bold: `Repite ${formatLoad(target.loadKg, loadBasis)} · ${formatSets(target.reps)}`,
        after: ', un mal día no cambia la meta.',
      };
  }
}
