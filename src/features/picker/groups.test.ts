import { groupFromTyped, muscleGroupLabel, orderMuscleGroups } from './groups';

describe('orderMuscleGroups', () => {
  it('with no history keeps the base order', () => {
    expect(orderMuscleGroups(new Map()).map((g) => g.name)).toEqual([
      'chest', 'back', 'biceps', 'triceps', 'shoulders', 'legs', 'glutes', 'calves', 'core', 'cardio',
    ]);
  });

  it('oldest first, never trained last, custom groups included', () => {
    const names = orderMuscleGroups(
      new Map([
        ['shoulders', '2026-09-27'],
        ['antebrazo', '2026-09-01'],
        ['chest', '2026-09-17'],
      ]),
    ).map((g) => g.name);
    expect(names.slice(0, 3)).toEqual(['antebrazo', 'chest', 'shoulders']);
    expect(names.at(-1)).toBe('cardio');
  });
});

describe('labels and "Otro…" (neutral keys, decided with Jason)', () => {
  it('a base key shows its Spanish label; a custom group, as typed', () => {
    expect(['shoulders', 'triceps', 'calves', 'antebrazo'].map(muscleGroupLabel)).toEqual(['Hombro', 'Tríceps', 'Pantorrilla', 'Antebrazo']);
  });

  it('typing a base group’s name gives its key, with or without accents or case', () => {
    expect(['Pecho', 'triceps', 'TRÍCEPS', ' hombro ', 'shoulders'].map(groupFromTyped)).toEqual(['chest', 'triceps', 'triceps', 'shoulders', 'shoulders']);
  });

  it('anything else stays as typed, lowercase', () => {
    expect([groupFromTyped('Antebrazo'), groupFromTyped('  ')]).toEqual(['antebrazo', '']);
  });
});
