import type { NextTimeReason } from '@/domain/summary';

import { feedbackLine, nextTimeLine, pendingLine, tallyLines } from './templates';

const TODAY = '2026-09-29';

describe('feedbackLine (screen 4)', () => {
  it('"+1 rep por serie vs. el 27", in green', () => {
    expect(feedbackLine({ kind: 'reps_per_set', diff: 1, tone: 'up' }, '2026-09-27', TODAY, 'Press')).toEqual({
      text: 'Anotado · +1 rep por serie vs. el 27',
      tone: 'up',
    });
  });

  it('plural, totals, loads and a previous month', () => {
    expect(feedbackLine({ kind: 'reps_per_set', diff: 2, tone: 'up' }, '2026-09-27', TODAY, 'Press').text).toBe('Anotado · +2 reps por serie vs. el 27');
    expect(feedbackLine({ kind: 'reps_total', diff: 2, tone: 'up' }, '2026-09-27', TODAY, 'Press').text).toBe('Anotado · +2 reps vs. el 27');
    expect(feedbackLine({ kind: 'load', diffKg: 2.5, tone: 'up' }, '2026-08-30', TODAY, 'Press').text).toBe('Anotado · +2.5 kg vs. el 30 ago');
  });

  it('same or down is muted, never green', () => {
    expect(feedbackLine({ kind: 'same', tone: 'same' }, '2026-09-27', TODAY, 'Press')).toEqual({ text: 'Anotado · igual que el 27', tone: 'muted' });
    expect(feedbackLine({ kind: 'reps_per_set', diff: -1, tone: 'down' }, '2026-09-27', TODAY, 'Press')).toEqual({
      text: 'Anotado · −1 rep por serie vs. el 27',
      tone: 'muted',
    });
  });

  it('first time: with the name it got, in gray (design/photo.html)', () => {
    expect(feedbackLine({ kind: 'new' }, null, TODAY, 'Press de pecho en máquina')).toEqual({
      text: 'Anotado · Press de pecho en máquina · primera vez',
      tone: 'muted',
    });
  });
});

describe('screen 7 lines', () => {
  it('tally: only what happened, singular and plural', () => {
    expect(tallyLines({ up: 2, same: 1, down: 0, new: 1 })).toEqual([
      { text: '2 subieron', tone: 'up' },
      { text: '1 igual', tone: 'text' },
      { text: '1 nuevo', tone: 'muted' },
    ]);
    expect(tallyLines({ up: 1, same: 2, down: 2, new: 0 }).map((l) => l.text)).toEqual(['1 subió', '2 iguales', '2 bajaron']);
  });

  it('nothing logged (only pending, or all deleted): "Nada anotado"', () => {
    expect(tallyLines({ up: 0, same: 0, down: 0, new: 0 })).toEqual([{ text: 'Nada anotado', tone: 'muted' }]);
  });

  it('pending', () => {
    expect([pendingLine(0), pendingLine(1), pendingLine(2)]).toEqual([
      null,
      '1 pendiente, se anota cuando haya señal',
      '2 pendientes, se anotan cuando haya señal',
    ]);
  });

  const base = { exerciseId: 'm', config: { kind: 'compound' as const, repFloor: 8, repTop: 12, stepKg: 2.5 }, previous: null };
  const target = (reason: NextTimeReason, loadKg: number, reps: number[]) => ({ reason, loadKg, reps, gapDays: 0, effectiveTop: 12 });

  it('next time: the mockup’s load increase, per side', () => {
    const line = nextTimeLine({ ...base, name: 'Press en máquina', loadBasis: 'per_side', today: { date: '2026-09-28', loadKg: 20, reps: [12, 12, 12, 12] }, target: target('add_load', 22.5, [8, 8, 8, 8]) });
    expect(line.before + line.bold + line.after).toBe('Press en máquina: llegaste a 4×12, el tope. Sube a 22.5 kg/lado y vuelve a 8.');
    expect(line.bold).toBe('Sube a 22.5 kg/lado');
  });

  it('next time: back after a failed jump', () => {
    const line = nextTimeLine({ ...base, name: 'Press de hombro', loadBasis: 'per_dumbbell', today: { date: '2026-09-28', loadKg: 26, reps: [6, 6, 6, 6] }, target: target('failed_load_jump', 24, [9, 9, 9, 9]) });
    expect(line.before + line.bold + line.after).toBe('Press de hombro: con 26 kg quedaste bajo 8. Vuelve a 24 kg y busca 4×9.');
  });

  it('next time: repeat after a bad day', () => {
    const line = nextTimeLine({ ...base, name: 'Remo', loadBasis: 'total', today: { date: '2026-09-28', loadKg: 40, reps: [8, 8, 8] }, target: target('bad_day_repeat', 40, [10, 10, 10]) });
    expect(line.before + line.bold + line.after).toBe('Remo: hoy costó más. Repite 40 kg · 3×10, un mal día no cambia la meta.');
  });
});
