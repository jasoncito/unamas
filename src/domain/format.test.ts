import { formatExposure, formatKg, formatSets, formatShortDate } from './format';

describe('format', () => {
  it('drops trailing zeros from loads', () => {
    expect([24, 7.5, 13.75].map(formatKg)).toEqual(['24', '7.5', '13.75']);
  });

  it('groups sets by reps, higher first', () => {
    expect(formatSets([12, 12, 12, 10])).toBe('3×12 · 1×10');
    expect(formatSets([9, 11, 11, 11])).toBe('3×11 · 1×9');
  });

  it('formats an exposure', () => {
    expect(formatExposure(24, [8, 8, 8, 8])).toBe('24 kg · 4×8');
  });
});

describe('formatShortDate', () => {
  it('uses Spanish month abbreviations without a leading zero', () => {
    expect(formatShortDate('2026-09-07')).toBe('7 sep');
    expect(formatShortDate('2026-01-17')).toBe('17 ene');
    expect(formatShortDate('2026-12-31')).toBe('31 dic');
  });
});
