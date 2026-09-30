import { orderMuscleGroups } from './groups';

describe('orderMuscleGroups', () => {
  it('with no history keeps the base order', () => {
    expect(orderMuscleGroups(new Map()).map((g) => g.name)).toEqual([
      'pecho', 'espalda', 'bíceps', 'tríceps', 'hombro', 'pierna', 'glúteo', 'pantorrilla', 'core', 'cardio',
    ]);
  });

  it('oldest first, never trained last, custom groups included', () => {
    const names = orderMuscleGroups(
      new Map([
        ['hombro', '2026-09-27'],
        ['antebrazo', '2026-09-01'],
        ['pecho', '2026-09-17'],
      ]),
    ).map((g) => g.name);
    expect(names.slice(0, 3)).toEqual(['antebrazo', 'pecho', 'hombro']);
    expect(names.at(-1)).toBe('cardio');
  });
});
