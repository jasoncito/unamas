import { dayOf, deltaText, unitFor } from './format';
import { deltaLine, equipmentFor, greedyPlates, greenPlates, nearestIndex, rackRange, sortPlates, stackPitch, stackRange, sumPlates } from './logic';

describe('greedyPlates', () => {
  it('heaviest first, as many of each as fit', () => {
    expect(greedyPlates(32.5)).toEqual([20, 10, 2.5]);
    expect(greedyPlates(30)).toEqual([20, 10]);
    expect(greedyPlates(47.5)).toEqual([20, 20, 5, 2.5]);
    expect(greedyPlates(3.75)).toEqual([2.5, 1.25]);
  });
  it('nothing, or what the tray can’t make, rounds down', () => {
    expect(greedyPlates(0)).toEqual([]);
    expect(greedyPlates(1)).toEqual([]);
    expect(greedyPlates(11)).toEqual([10]);
  });
  it('sum and order on the sleeve', () => {
    expect(sumPlates([20, 10, 2.5])).toBe(32.5);
    expect(sortPlates([2.5, 20, 10])).toEqual([20, 10, 2.5]);
  });
});

describe('greenPlates (green = progress)', () => {
  it('only the plates beyond last time, when the total goes up', () => {
    expect(greenPlates([20, 10, 2.5], [20, 10])).toEqual([false, false, true]);
  });
  it('a multiset: a second 10 is new even if a 10 was there', () => {
    expect(greenPlates([20, 10, 10], [20, 10])).toEqual([false, false, true]);
  });
  it('a different configuration for more: what was not there is green', () => {
    // 20+10 (30) → 20+5+5+2.5 (32.5): the 20 repeats; 5, 5 and 2.5 are new.
    expect(greenPlates([20, 5, 5, 2.5], [20, 10])).toEqual([false, true, true, true]);
  });
  it('same or less in total: nothing green, whatever the plates', () => {
    expect(greenPlates([20, 5, 5], [20, 10])).toEqual([false, false, false]);
    expect(greenPlates([20], [20, 10])).toEqual([false]);
  });
  it('no last time: nothing green', () => {
    expect(greenPlates([20], null)).toEqual([false]);
  });
});

describe('stackRange', () => {
  it('from one step to max(last × 2, last + 10 steps)', () => {
    expect(stackRange(2.5, 7.5)).toEqual([2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5]); // 7.5 + 25
    expect(stackRange(5, 40).at(-1)).toBe(90); // 40 + 10 steps beats 40 × 2
    expect(stackRange(5, 80).at(-1)).toBe(160); // 80 × 2
    expect(stackRange(5, 40)[0]).toBe(5);
  });
  it('no last time: 20 steps', () => {
    expect(stackRange(2.5, null)).toHaveLength(20);
  });
});

describe('rackRange and nearestIndex', () => {
  it('step by step up to 50', () => {
    const r = rackRange(2);
    expect([r[0], r.at(-1), r.length]).toEqual([2, 50, 25]);
    expect(rackRange(2.5).at(-1)).toBe(50);
  });
  it('the closest value', () => {
    expect(nearestIndex([2, 4, 6], 4.9)).toBe(1);
    expect(nearestIndex([2, 4, 6], 99)).toBe(2);
  });
});

describe('stackPitch', () => {
  it('what fits, counting the gap under the pin, between 26 and 36', () => {
    expect(stackPitch(400, 10)).toEqual({ pitch: 36, gap: 14, windowed: false });
    const p = stackPitch(312, 10); // 312 / 10.4 = 30
    expect(p).toEqual({ pitch: 30, gap: 12, windowed: false });
    expect(p.pitch * 10 + p.gap).toBeLessThanOrEqual(312); // the last plate is never cut
  });
  it('not even at 26: a window that follows the pin', () => {
    expect(stackPitch(300, 13)).toEqual({ pitch: 26, gap: 10, windowed: true });
  });
});

describe('the delta line', () => {
  const last = { loadKg: 30, day: '24' };
  it('up: "+X kg · apunta a <floor> o más"', () => {
    const l = deltaLine(32.5, last, 6, { loadKg: 32.5, reps: [6, 6, 6, 6] });
    expect(l).toEqual({ kind: 'up', diffKg: 2.5, repFloor: 6 });
    expect(deltaText(l!)).toBe('+2.5 kg · apunta a 6 o más');
  });
  it('same: "igual que el <día> · apunta a <target>" when the engine suggests this load', () => {
    const l = deltaLine(7.5, { loadKg: 7.5, day: '27' }, 10, { loadKg: 7.5, reps: [11, 11, 11, 11] });
    expect(deltaText(l!)).toBe('igual que el 27 · apunta a 4×11');
  });
  it('same, but the engine suggests another load: no target', () => {
    expect(deltaText(deltaLine(30, last, 6, { loadKg: 32.5, reps: [6, 6, 6, 6] })!)).toBe('igual que el 24');
  });
  it('down: "−X kg que el <día>"', () => {
    expect(deltaText(deltaLine(27.5, last, 6, null)!)).toBe('−2.5 kg que el 24');
  });
  it('first time: no line', () => {
    expect(deltaLine(20, null, 8, null)).toBeNull();
  });
});

describe('labels', () => {
  it('equipment and unit follow the load basis', () => {
    expect(['per_side', 'stack', 'per_dumbbell', 'total'].map((b) => equipmentFor(b as never))).toEqual(['bar', 'stack', 'rack', 'rack']);
    expect(['per_side', 'stack', 'per_dumbbell', 'total'].map((b) => unitFor(b as never))).toEqual(['kg por lado', 'kg', 'kg c/u', 'kg']);
  });
  it('the day: number in the same month, with the month otherwise', () => {
    expect([dayOf('2026-09-27', '2026-09-29'), dayOf('2026-08-30', '2026-09-29')]).toEqual(['27', '30 ago']);
  });
});
