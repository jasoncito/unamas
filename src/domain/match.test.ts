import { normalizeWithMap, searchExercises, type SearchCandidate } from './match';

const C: SearchCandidate[] = [
  { id: 'press_mancuernas', name: 'Press de hombro con mancuernas', aliases: ['press de hombros'], muscleGroups: ['shoulders'] },
  { id: 'press_maquina', name: 'Press de hombro en máquina', aliases: ['press militar máquina'], muscleGroups: ['shoulders'] },
  { id: 'press_banca', name: 'Press de banca plano con barra', aliases: ['press banca', 'bench press'], muscleGroups: ['chest'] },
  { id: 'pushdown', name: 'Tríceps en polea con barra V (pushdown)', aliases: ['pushdown'], muscleGroups: ['triceps'] },
  { id: 'laterales', name: 'Elevaciones laterales en polea', aliases: ['laterales en polea'], muscleGroups: ['shoulders'] },
];
const ids = (q: string, groups: string[] = ['shoulders'], limit?: number) => searchExercises(q, C, groups, limit).map((r) => r.id);

describe('searchExercises', () => {
  it('"press de hom" finds both shoulder presses and highlights the typed part', () => {
    const res = searchExercises('press de hom', C, ['shoulders']);
    expect(res.map((r) => r.id)).toEqual(['press_mancuernas', 'press_maquina']);
    const [start, end] = res[0].highlight!;
    expect(C[0].name.slice(start, end)).toBe('Press de hom');
  });

  it('the chosen muscle groups come first', () => {
    expect(ids('press', ['chest'])[0]).toBe('press_banca');
    expect(ids('press', ['shoulders'])[2]).toBe('press_banca');
  });

  it('ignores case and accents, and highlights over the original accents', () => {
    const res = searchExercises('TRICEPS', C, ['triceps']);
    expect(res[0].id).toBe('pushdown');
    const [s, e] = res[0].highlight!;
    expect(C[3].name.slice(s, e)).toBe('Tríceps');
  });

  it('matches aliases; the name is not highlighted if it does not contain the text', () => {
    expect(searchExercises('bench', C, [])).toEqual([{ id: 'press_banca', highlight: null }]);
  });

  it('every typed word as the start of a word: "pre hom maq"', () => {
    expect(ids('pre hom maq')).toEqual(['press_maquina']);
  });

  it('a match at the start of a word beats one in the middle of a word', () => {
    // "lat" starts "laterales" (Elevaciones laterales) but is inside no other name.
    expect(ids('lat')).toEqual(['laterales']);
  });

  it('a name match beats an equal alias match', () => {
    const cs: SearchCandidate[] = [
      { id: 'abd', name: 'Abductores con banda', aliases: ['zancada lateral banda'], muscleGroups: [] },
      { id: 'zan', name: 'Zancada lateral', aliases: [], muscleGroups: [] },
    ];
    expect(searchExercises('zanca', cs, []).map((r) => r.id)).toEqual(['zan', 'abd']);
  });

  it('the start of a word beats the middle of a word', () => {
    const cs: SearchCandidate[] = [
      { id: 'est', name: 'Estiramiento de isquios', aliases: [], muscleGroups: [] },
      { id: 'jal', name: 'Jalón con tira', aliases: [], muscleGroups: [] },
    ];
    expect(searchExercises('tira', cs, []).map((r) => r.id)).toEqual(['jal', 'est']);
  });

  it('the best of name and aliases counts, and the name is still highlighted', () => {
    const cs: SearchCandidate[] = [
      { id: 'press', name: 'Press copa', aliases: [], muscleGroups: [] },
      { id: 'tri', name: 'Tríceps copa', aliases: ['copa con mancuerna'], muscleGroups: [] },
    ];
    const res = searchExercises('copa', cs, []);
    expect(res.map((r) => r.id)).toEqual(['tri', 'press']); // alias start (100) beats name word start (85)
    expect(cs[1].name.slice(...res[0].highlight!)).toBe('copa');
  });

  it('typed words must come in order', () => {
    expect(ids('hom pre')).toEqual([]);
  });

  it('at most 3 by default', () => {
    expect(ids('p', [])).toEqual([]); // too short
    expect(ids('pr', []).length).toBeLessThanOrEqual(3);
    expect(ids('pr', [], 2)).toHaveLength(2);
  });

  it('nothing matches → nothing', () => {
    expect(ids('sentadilla')).toEqual([]);
  });
});

describe('normalizeWithMap', () => {
  it('maps each normalized char back to the original', () => {
    const { text, map } = normalizeWithMap('  Trí  ceps ');
    expect(text).toBe('tri ceps');
    expect(map).toEqual([2, 3, 4, 5, 7, 8, 9, 10]);
  });
});
