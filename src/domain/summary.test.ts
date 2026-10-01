import { nextTarget } from './engine';
import { formatClock, formatDayLabel, formatDuration } from './format';
import { pickNextTime, summarize, type SummaryItem } from './summary';
import type { ExerciseConfig, Exposure } from './types';

const sets = (n: number, r: number) => Array<number>(n).fill(r);
const x = (date: string, loadKg: number, reps: number[]): Exposure => ({ date, loadKg, reps });
const compound: ExerciseConfig = { kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5 };
const TODAY = '2026-09-28';

function item(name: string, history: Exposure[], today: Exposure, config = compound): SummaryItem {
  return {
    exerciseId: name,
    name,
    loadBasis: 'total',
    config,
    previous: history.at(-1) ?? null,
    today,
    target: nextTarget([...history, today], config, TODAY),
  };
}

// The mockup's session (design/flow.html, screens 6–7).
const press = item('Press de hombro', [x('2026-09-27', 24, sets(4, 8))], x(TODAY, 24, sets(4, 9)));
const laterales = item('Laterales en polea', [x('2026-09-27', 7.5, sets(4, 10))], x(TODAY, 7.5, [11, 11, 11, 9]), {
  kind: 'isolation', repFloor: 10, repTop: 15, stepKg: 1.25,
});
const maquina = item('Press en máquina', [x('2026-09-17', 20, sets(4, 12))], x(TODAY, 20, sets(4, 12)));
const remo = item('Remo al mentón', [], x(TODAY, 15, sets(3, 12)));

describe('summarize (PROGRESSION.md §5)', () => {
  it('the mockup: 2 up, 1 same, 1 new — each against its own last time', () => {
    const { rows, tally } = summarize([press, laterales, maquina, remo]);
    expect(tally).toEqual({ up: 2, same: 1, down: 0, new: 1 });
    expect(rows.map((r) => [r.name, r.verdict, r.previous?.date ?? null])).toEqual([
      ['Press de hombro', 'up', '2026-09-27'],
      ['Laterales en polea', 'up', '2026-09-27'],
      ['Press en máquina', 'same', '2026-09-17'],
      ['Remo al mentón', 'new', null],
    ]);
  });

  it('fewer reps at the same load → down', () => {
    const worse = item('Press de hombro', [x('2026-09-27', 24, sets(4, 9))], x(TODAY, 24, sets(4, 8)));
    expect(summarize([worse]).tally).toEqual({ up: 0, same: 0, down: 1, new: 0 });
  });
});

describe('pickNextTime', () => {
  it('a load increase wins: the mockup’s press en máquina, 4×12 at the top → 22.5', () => {
    const next = pickNextTime([press, laterales, maquina, remo])!;
    expect(next.name).toBe('Press en máquina');
    expect(next.target).toMatchObject({ reason: 'add_load', loadKg: 22.5, reps: sets(4, 8) });
  });

  it('else going back after a failed jump', () => {
    const failed = item('Press de hombro', [x('2026-09-20', 24, sets(4, 12))], x(TODAY, 26, sets(4, 6)));
    expect(pickNextTime([press, failed])).toMatchObject({ name: 'Press de hombro', target: { reason: 'failed_load_jump', loadKg: 24 } });
  });

  it('only +1 rep everywhere: nothing to single out', () => {
    expect(pickNextTime([press, remo])).toBeNull();
  });
});

describe('summary formats', () => {
  it('day label', () => {
    expect([formatDayLabel('2026-09-28'), formatDayLabel('2026-09-27'), formatDayLabel('2026-10-03')]).toEqual(['Lunes 28', 'Domingo 27', 'Sábado 3']);
  });

  it('duration: never 0, hours with padded minutes', () => {
    expect([formatDuration(10_000), formatDuration(58 * 60_000), formatDuration(65 * 60_000)]).toEqual(['1 min', '58 min', '1 h 05 min']);
  });

  it('stopwatch', () => {
    expect([formatClock(247_000), formatClock(2_530_000), formatClock(3_725_000), formatClock(-5)]).toEqual(['4:07', '42:10', '1:02:05', '0:00']);
  });
});
