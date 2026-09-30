import { normalizeName, phraseToAlias } from './names';

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

describe('phraseToAlias', () => {
  it.each([
    ['jalones en la polea arriba para hombro posterior, con 25, 4 de 12', 'jalones en la polea arriba para hombro posterior'],
    ['laterales con 10, 4 de 11', 'laterales'],
    ['press de hombros con mancuernas de 24 4 de 8', 'press de hombros con mancuernas'],
    ['elevaciones laterales de hombros en polea con 7,5. 4 de 10 cada hombro', 'elevaciones laterales de hombros en polea'],
    ['bicep curl con barra z 11.5 kilos a cada lado, 11 repeticiones 4 series', 'bicep curl con barra z'],
    ['curl martillo en poleas 25k 4x10', 'curl martillo en poleas'],
    ['tríceps sobre la cabeza 20 kg, cuatro de diez, me sobraron 3', 'triceps sobre la cabeza'],
    ['Press   de Hombro, 24 kilos, 4 de 9, fácil', 'press de hombro'],
  ])('%s → %s', (phrase, alias) => {
    expect(phraseToAlias(phrase)).toBe(alias);
  });

  it('a number in the middle takes its "con" but not the words after it', () => {
    expect(phraseToAlias('curl con 12 kilos en banco inclinado 3 de 10')).toBe('curl en banco inclinado');
  });

  it('trims connectors left at either end', () => {
    expect(phraseToAlias('y el press de hombro con 24 4 de 9')).toBe('press de hombro');
    expect(phraseToAlias('laterales 10 kilos con')).toBe('laterales'); // dictation cut short
  });

  it('keeps "con" and "de" that belong to the name', () => {
    expect(phraseToAlias('curl con barra z de pie 30 4 de 10')).toBe('curl con barra z de pie');
  });

  it('nothing name-like left → null', () => {
    expect(phraseToAlias('24 kilos 4 de 9')).toBeNull();
    expect(phraseToAlias('con 10')).toBeNull();
    expect(phraseToAlias('z 24 4 de 9')).toBeNull(); // a single letter is not a name
  });
});
