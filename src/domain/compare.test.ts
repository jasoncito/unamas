import { compareExposures } from './compare';
import type { Exposure } from './types';

const x = (loadKg: number, reps: number[]): Exposure => ({ date: '2026-09-29', loadKg, reps });
const sets = (n: number, reps: number) => Array<number>(n).fill(reps);

describe('compareExposures (PROGRESSION.md §5)', () => {
  it('tríceps en polea: 25 kg 3×10 → 30 kg 4×10 is up', () => {
    expect(compareExposures(x(25, sets(3, 10)), x(30, sets(4, 10)), 10)).toBe('up');
  });

  it('curl barra Z: 11.5 kg 4×11 → 12.5 kg 4×10 is up', () => {
    expect(compareExposures(x(11.5, sets(4, 11)), x(12.5, sets(4, 10)), 10)).toBe('up');
  });

  describe('same load compares total reps', () => {
    it.each([
      [[8, 8, 8, 8], 'same'],
      [[9, 8, 8, 8], 'up'],
      [[8, 8, 8, 7], 'down'],
    ])('24 kg 4×8 → 24 kg %j is %s', (reps, expected) => {
      expect(compareExposures(x(24, sets(4, 8)), x(24, reps), 8)).toBe(expected);
    });
  });

  describe('otherwise compares the best set by estimated 1RM (±1 %)', () => {
    it.each([
      [22, sets(4, 10), 'down'], // lighter, more reps, still weaker
      [22, sets(4, 8), 'down'],
      [26, sets(4, 7), 'up'], // heavier but under the floor: e1RM decides
      [23, sets(4, 10), 'same'], // e1RM 30.67 vs 30.4: +0.9 %, inside the band
      [22, sets(4, 12), 'up'], // e1RM 30.8 vs 30.4: +1.3 %, outside the band
      [25, sets(4, 6), 'down'], // heavier but under the floor and weaker: not an automatic "up"
    ])('24 kg 4×8 → %s kg %j is %s', (load, reps, expected) => {
      expect(compareExposures(x(24, sets(4, 8)), x(load, reps), 8)).toBe(expected);
    });

    it('slightly weaker (within 1 %) is same: 30 kg 4×10 → 26 kg 4×16', () => {
      expect(compareExposures(x(30, sets(4, 10)), x(26, sets(4, 16)), 10)).toBe('same');
    });
  });
});
