import { signed, type Delta } from '@/domain/delta';
import { formatShortDate } from '@/domain/format';
import type { IsoDate } from '@/domain/types';

// Feedback phrases (CLAUDE.md §8, screen 4). The AI never writes these: they come from the numbers.

export interface FeedbackLine {
  text: string;
  /** Green only when it went up (CLAUDE.md §1: green means progress). */
  tone: 'up' | 'muted';
}

/** "Anotado · +1 rep por serie vs. el 27", "Anotado · primera vez, queda como referencia". */
export function feedbackLine(delta: Delta, previousDate: IsoDate | null, today: IsoDate): FeedbackLine {
  if (delta.kind === 'new' || !previousDate) return { text: 'Anotado · primera vez, queda como referencia', tone: 'muted' };
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
