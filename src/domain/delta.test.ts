import { deltaOf, shortDelta, signed } from './delta';
import type { Exposure } from './types';

const x = (loadKg: number, reps: number[]): Exposure => ({ date: '2026-09-27', loadKg, reps });
const sets = (n: number, r: number) => Array<number>(n).fill(r);

describe('deltaOf', () => {
  it('no previous entry → new', () => {
    expect(deltaOf(null, x(15, sets(3, 12)), 8)).toEqual({ kind: 'new' });
  });

  it('+1 rep on every set (screen 4: "+1 rep por serie")', () => {
    expect(deltaOf(x(24, sets(4, 8)), x(24, sets(4, 9)), 8)).toEqual({ kind: 'reps_per_set', diff: 1, tone: 'up' });
  });

  it('uneven change → total reps (laterales 4×10 → 3×11·1×9 is +2)', () => {
    expect(deltaOf(x(7.5, sets(4, 10)), x(7.5, [11, 11, 11, 9]), 10)).toEqual({ kind: 'reps_total', diff: 2, tone: 'up' });
  });

  it('one more set, same reps: "+1 serie"', () => {
    const d = deltaOf(x(25, sets(3, 10)), x(25, sets(4, 10)), 10);
    expect(d).toEqual({ kind: 'sets', setsDiff: 1, repsDiff: 0, tone: 'up' });
    expect(shortDelta(d)).toBe('+1 serie');
  });

  it('sets and reps at once (pantorrilla 4×17 → 3×20): "−1 serie · +3 reps", not a lone "−8"', () => {
    const d = deltaOf(x(12, sets(4, 17)), x(12, sets(3, 20)), 12);
    expect(d).toEqual({ kind: 'sets', setsDiff: -1, repsDiff: 3, tone: 'down' });
    expect(shortDelta(d)).toBe('−1 serie · +3 reps');
  });

  it('uneven sets: just the sets, plural', () => {
    expect(shortDelta(deltaOf(x(20, [12, 10, 8]), x(20, [12, 12, 10, 9, 8]), 8))).toBe('+2 series');
  });

  it('same numbers → same', () => {
    expect(deltaOf(x(20, sets(4, 12)), x(20, sets(4, 12)), 8)).toEqual({ kind: 'same', tone: 'same' });
  });

  it('fewer reps → down', () => {
    expect(deltaOf(x(24, sets(4, 9)), x(24, sets(4, 8)), 8)).toEqual({ kind: 'reps_per_set', diff: -1, tone: 'down' });
  });

  it('a heavier load is described by the load, toned by §5', () => {
    expect(deltaOf(x(30, sets(4, 10)), x(32.5, sets(4, 6)), 6)).toEqual({ kind: 'load', diffKg: 2.5, tone: 'up' });
    expect(deltaOf(x(11.5, sets(4, 11)), x(12.5, sets(4, 10)), 10)).toMatchObject({ kind: 'load', diffKg: 1, tone: 'up' });
  });

  it('a lighter load', () => {
    expect(deltaOf(x(24, sets(4, 8)), x(22, sets(4, 8)), 8)).toMatchObject({ kind: 'load', diffKg: -2, tone: 'down' });
  });
});

describe('shortDelta (screen 7)', () => {
  it.each([
    [{ kind: 'new' } as const, 'nuevo'],
    [{ kind: 'same', tone: 'same' } as const, '='],
    [{ kind: 'reps_per_set', diff: 1, tone: 'up' } as const, '+1'],
    [{ kind: 'reps_total', diff: 2, tone: 'up' } as const, '+2'],
    [{ kind: 'reps_per_set', diff: -1, tone: 'down' } as const, '−1'],
    [{ kind: 'load', diffKg: 2, tone: 'up' } as const, '+2 kg'],
    [{ kind: 'load', diffKg: -2.5, tone: 'down' } as const, '−2.5 kg'],
  ])('%j → %s', (d, text) => {
    expect(shortDelta(d)).toBe(text);
  });

  it('signed uses a real minus sign', () => {
    expect(signed(-1)).toBe('−1');
    expect(signed(0)).toBe('+0');
  });
});
