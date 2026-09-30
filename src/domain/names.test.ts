import { normalizeName } from './names';

describe('normalizeName', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalizeName('  Extensión de TRÍCEPS   en polea ')).toBe('extension de triceps en polea');
    expect(normalizeName('Press de hombro\tcon  mancuernas')).toBe('press de hombro con mancuernas');
  });

  it('drops the tilde of ñ too', () => {
    expect(normalizeName('Remo con ñ')).toBe('remo con n');
  });

  it('keeps different words different (no fuzzy matching)', () => {
    expect(normalizeName('Press hombro mancuernas')).not.toBe(normalizeName('Press de hombro con mancuernas'));
  });
});
