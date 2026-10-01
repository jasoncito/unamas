import { feedbackLine } from './templates';

const TODAY = '2026-09-29';

describe('feedbackLine (screen 4)', () => {
  it('"+1 rep por serie vs. el 27", in green', () => {
    expect(feedbackLine({ kind: 'reps_per_set', diff: 1, tone: 'up' }, '2026-09-27', TODAY)).toEqual({
      text: 'Anotado · +1 rep por serie vs. el 27',
      tone: 'up',
    });
  });

  it('plural, totals, loads and a previous month', () => {
    expect(feedbackLine({ kind: 'reps_per_set', diff: 2, tone: 'up' }, '2026-09-27', TODAY).text).toBe('Anotado · +2 reps por serie vs. el 27');
    expect(feedbackLine({ kind: 'reps_total', diff: 2, tone: 'up' }, '2026-09-27', TODAY).text).toBe('Anotado · +2 reps vs. el 27');
    expect(feedbackLine({ kind: 'load', diffKg: 2.5, tone: 'up' }, '2026-08-30', TODAY).text).toBe('Anotado · +2.5 kg vs. el 30 ago');
  });

  it('same or down is muted, never green', () => {
    expect(feedbackLine({ kind: 'same', tone: 'same' }, '2026-09-27', TODAY)).toEqual({ text: 'Anotado · igual que el 27', tone: 'muted' });
    expect(feedbackLine({ kind: 'reps_per_set', diff: -1, tone: 'down' }, '2026-09-27', TODAY)).toEqual({
      text: 'Anotado · −1 rep por serie vs. el 27',
      tone: 'muted',
    });
  });

  it('first time: stays as the reference', () => {
    expect(feedbackLine({ kind: 'new' }, null, TODAY)).toEqual({ text: 'Anotado · primera vez, queda como referencia', tone: 'muted' });
  });
});
