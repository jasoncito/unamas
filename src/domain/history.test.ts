import { bestOfEachSession } from './history';

const e = (id: string, sessionId: string, loadKg: number, reps: number[]) => ({ id, sessionId, loadKg, reps });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('bestOfEachSession (PROGRESSION.md §4)', () => {
  it('one entry per session: unchanged', () => {
    const h = [e('a', 's1', 24, [8, 8]), e('b', 's2', 24, [9, 9])];
    expect(bestOfEachSession(h)).toEqual(h);
  });

  it('more load wins, even with fewer reps (a lighter second try does not count)', () => {
    expect(ids(bestOfEachSession([e('a', 's1', 26, [6, 6, 6, 6]), e('b', 's1', 24, [9, 9, 9, 9])]))).toEqual(['a']);
    expect(ids(bestOfEachSession([e('a', 's1', 20, [12, 12]), e('b', 's1', 24, [8, 8])]))).toEqual(['b']);
  });

  it('same load: more total reps wins', () => {
    expect(ids(bestOfEachSession([e('a', 's1', 24, [10, 9, 9, 9]), e('b', 's1', 24, [9, 9, 9, 9])]))).toEqual(['a']);
    expect(ids(bestOfEachSession([e('a', 's1', 24, [9, 9, 9]), e('b', 's1', 24, [8, 8, 8, 8])]))).toEqual(['b']);
  });

  it('a full tie: the later one', () => {
    expect(ids(bestOfEachSession([e('a', 's1', 24, [9, 9]), e('b', 's1', 24, [10, 8])]))).toEqual(['b']);
  });

  it('several sessions keep their order, oldest first', () => {
    const h = [e('a', 's1', 20, [10]), e('b', 's1', 22.5, [8]), e('c', 's2', 22.5, [9]), e('d', 's3', 22.5, [10]), e('f', 's3', 25, [6])];
    expect(ids(bestOfEachSession(h))).toEqual(['b', 'c', 'f']);
  });
});
