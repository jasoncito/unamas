import seedJson from '../../../dev/seed.json';
import type { ParseRequest, ParseResponse } from '../../../shared/contract';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { getAllExercises, getExercise } from '@/data/repos/exercises';
import { getOpenSession } from '@/data/repos/sessions';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { AiUnavailableError, type AiService } from '@/services/ai';

import { createSessionActions, type SessionContext } from './actions';
import { initialState, sessionReducer, type SessionEvent, type SessionState } from './reducer';

const COPY = { unclear: 'No te entendí', offline: 'Sin señal', stopTip: 'Mantén el ■' };
const log = (entries: ParseResponse['entries']): ParseResponse => ({ intent: 'log', entries, ambiguity: null, reply: null });
const entry = (over: Partial<ParseResponse['entries'][number]>): ParseResponse['entries'][number] => ({
  exercise_id: null, new_exercise: null, load_kg: 24, reps: [9, 9, 9, 9], rir_note: null, easy: false, ...over,
});

let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
});

/** A session screen wired to a scripted AI. */
function harness(answers: (ParseResponse | Error)[], ctx: SessionContext = { sessionId: null, groups: ['hombro', 'tríceps'] }) {
  let state: SessionState = initialState;
  const events: SessionEvent[] = [];
  const requests: ParseRequest[] = [];
  const created: string[] = [];
  let syncs = 0;
  let n = 0;
  const ai: AiService = {
    async parse(req) {
      requests.push(req);
      const a = answers.shift();
      if (!a) throw new Error('no scripted answer');
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const actions = createSessionActions(
    { db, ai, newId: () => `f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, now: () => '2026-09-29T18:00:00.000Z', today: () => '2026-09-29', requestSync: () => void syncs++ },
    ctx,
    () => state,
    (e) => {
      events.push(e);
      state = sessionReducer(state, e);
    },
    COPY,
    (id) => created.push(id),
  );
  return { actions, ctx, events, requests, created, state: () => state, syncs: () => syncs };
}

const entries = () => db.getAllAsync<{ id: string; status: string; exercise_id: string | null; load_kg: number | null; raw_text: string }>(
  "SELECT id, status, exercise_id, load_kg, raw_text FROM entry WHERE created_at >= '2026-09-29' ORDER BY id", []);

describe('send: the first entry', () => {
  it('creates the session at that moment, logs it and shows the delta vs. its last time', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    await h.actions.send('press de hombro 24 4 de 9');

    const session = (await getOpenSession(db))!;
    expect(session).toMatchObject({ muscleGroups: ['hombro', 'tríceps'], startedAt: '2026-09-29T18:00:00.000Z' });
    expect(h.created).toEqual([session.id]);
    expect(await entries()).toEqual([
      expect.objectContaining({ status: 'ok', exercise_id: ids.get('press_hombro_mancuernas'), load_kg: 24 }),
    ]);
    expect(h.state()).toMatchObject({
      phase: 'feedback',
      bubble: 'press de hombro 24 4 de 9',
      logged: 1,
      feedback: { text: 'Anotado · +1 rep por serie vs. el 27', tone: 'up' },
    });
    expect(h.syncs()).toBe(1);
  });

  it('sends their exercises with their last time, the session groups first', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    await h.actions.send('press de hombro 24 4 de 9');
    const ctx = h.requests[0].context;
    expect(ctx.muscle_groups).toEqual(['hombro', 'tríceps']);
    expect(ctx.exercises).toHaveLength(24);
    expect(ctx.exercises[0].muscle_groups.some((g) => ['hombro', 'tríceps'].includes(g))).toBe(true);
    expect(ctx.exercises.find((e) => e.id === ids.get('press_hombro_mancuernas'))!.last).toEqual({ date: '2026-09-27', load_kg: 24, reps: [8, 8, 8, 8] });
  });

  it('a later entry reuses the session', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]), log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('press 24 4 de 9');
    await h.actions.send('laterales en polea 7,5 4 de 11');
    expect(h.created).toHaveLength(1);
    expect(h.state()).toMatchObject({ logged: 2 });
  });
});

describe('send: not an entry', () => {
  it('not understood → the reply, and neither the message nor an empty session is left', async () => {
    const h = harness([{ intent: 'unclear', entries: [], ambiguity: null, reply: null }]);
    await h.actions.send('hola');
    expect(await entries()).toEqual([]);
    expect(await getOpenSession(db)).toBeNull();
    expect(h.ctx.sessionId).toBeNull();
    expect(h.created).toEqual([]);
    expect(h.state()).toEqual({ phase: 'ready', text: '', logged: 0, reply: 'No te entendí' });
  });

  it('"listo" → the stop tip; it does not end the session (CLAUDE.md §8)', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]), { intent: 'end_session', entries: [], ambiguity: null, reply: null }]);
    await h.actions.send('press 24 4 de 9');
    await h.actions.send('listo');
    expect(h.state()).toMatchObject({ phase: 'ready', reply: 'Mantén el ■' });
    expect((await getOpenSession(db))!.endedAt).toBeNull();
  });

  it('a question gets its reply', async () => {
    const h = harness([{ intent: 'question', entries: [], ambiguity: null, reply: 'Te toca hombro.' }]);
    await h.actions.send('¿qué me toca?');
    expect(h.state()).toMatchObject({ reply: 'Te toca hombro.' });
  });
});

describe('send: no signal', () => {
  it('the entry stays pending in a real session, nothing is lost', async () => {
    const h = harness([new AiUnavailableError('offline')]);
    await h.actions.send('press 24 4 de 9');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'pending', raw_text: 'press 24 4 de 9' })]);
    expect(await getOpenSession(db)).not.toBeNull();
    expect(h.created).toHaveLength(1);
    expect(h.state()).toMatchObject({ phase: 'ready', reply: 'Sin señal' });
  });
});

describe('doubts (screen 5)', () => {
  const which: ParseResponse = {
    intent: 'ambiguous',
    entries: [],
    ambiguity: { question: '¿Cuáles laterales?', options: [] },
    reply: null,
  };

  it('which one? → the entry waits as ambiguous; options carry their last load', async () => {
    const options = [{ exercise_id: 'x', label: 'x' }];
    const ask = { ...which, ambiguity: { question: '¿Cuáles laterales?', options: [
      { exercise_id: ids.get('laterales_polea')!, label: 'En polea' },
      { exercise_id: ids.get('laterales_pie_mancuernas')!, label: 'De pie' },
    ] } };
    void options;
    const h = harness([ask]);
    await h.actions.send('laterales con 10, 4 de 11');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ambiguous' })]);
    expect(h.state()).toMatchObject({
      phase: 'disambiguating',
      said: 'laterales con 10, 4 de 11',
      question: '¿Cuáles laterales?',
      options: [
        { exerciseId: ids.get('laterales_polea'), label: 'En polea', lastLoadKg: 7.5 },
        { exerciseId: ids.get('laterales_pie_mancuernas'), label: 'De pie', lastLoadKg: 16 },
      ],
    });
  });

  it('tapping one: learns the alias, parses again with only that exercise, and logs it', async () => {
    const polea = ids.get('laterales_polea')!;
    const ask = { ...which, ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: polea, label: 'En polea' }, { exercise_id: ids.get('laterales_pie_mancuernas')!, label: 'De pie' }] } };
    const h = harness([ask, log([entry({ exercise_id: polea, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('laterales con 10, 4 de 11');
    await h.actions.choose(polea);

    expect(h.requests[1].context.exercises.map((e) => e.id)).toEqual([polea]);
    expect(h.requests[1].text).toBe('laterales con 10, 4 de 11');
    expect((await getExercise(db, polea))!.aliases).toContain('laterales');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok', exercise_id: polea, load_kg: 10 })]);
    expect(h.state()).toMatchObject({ phase: 'feedback', logged: 1 });
  });

  it('"¿Con cuánto peso?" → their answer joins the phrase and it is parsed again', async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    const h = harness([{ ...which, ambiguity: { question: '¿Con cuánto peso?', options: [] } }, log([entry({ exercise_id: press })])]);
    await h.actions.send('press de hombro 4 de 9');
    await h.actions.send('24');
    expect(h.requests[1].text).toBe('press de hombro 4 de 9, 24');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok', raw_text: 'press de hombro 4 de 9, 24' })]);
  });

  it('"U otra cosa": a typed answer to which-one joins the phrase too', async () => {
    const ask = { ...which, ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: ids.get('laterales_polea')!, label: 'En polea' }] } };
    const h = harness([ask, log([entry({ exercise_id: ids.get('frontales_mancuernas')!, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('laterales con 10, 4 de 11');
    await h.actions.send('eran frontales');
    expect(h.requests[1].text).toBe('laterales con 10, 4 de 11 (eran frontales)');
  });
});

describe('new exercises', () => {
  it('created with the short name, their words as alias, the range of its kind and a default step', async () => {
    const h = harness([log([entry({ load_kg: 15, reps: [12, 12, 12], new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['hombro'], kind: 'compound', load_basis: 'total' } })])]);
    await h.actions.send('remo al mentón con barra 15 kilos 3 de 12');
    const created = (await getAllExercises(db)).find((e) => e.canonicalName === 'Remo al mentón')!;
    expect(created).toMatchObject({ aliases: ['remo al menton con barra'], kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5, loadBasis: 'total' });
    expect(h.state()).toMatchObject({ feedback: { text: 'Anotado · primera vez, queda como referencia', tone: 'muted' } });
  });
});

describe('two exercises in one message', () => {
  it('saves both, each its own entry, and the line speaks of the first', async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    const polea = ids.get('laterales_polea')!;
    const h = harness([log([entry({ exercise_id: press }), entry({ exercise_id: polea, load_kg: 7.5, reps: [10, 10, 10, 10] })])]);
    await h.actions.send('press 24 4 de 9 y laterales 7,5 4 de 10');
    const saved = await entries();
    expect(saved).toHaveLength(2);
    expect(saved.map((e) => [e.status, e.exercise_id]).sort()).toEqual([['ok', polea], ['ok', press]].sort());
    expect(h.state()).toMatchObject({ logged: 2, feedback: { text: 'Anotado · +1 rep por serie vs. el 27' } });
  });
});

describe('retry (the app reopened)', () => {
  it('an entry left pending without signal is parsed again and logged', async () => {
    const first = harness([new AiUnavailableError('offline')]);
    await first.actions.send('press 24 4 de 9');
    const again = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])], { sessionId: first.ctx.sessionId, groups: ['hombro'] });
    await again.actions.retry();
    expect(again.requests[0].text).toBe('press 24 4 de 9');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok' })]);
    expect(again.state()).toMatchObject({ phase: 'feedback', bubble: 'press 24 4 de 9' });
  });

  it('nothing unresolved: nothing is sent', async () => {
    const h = harness([], { sessionId: null, groups: ['hombro'] });
    await h.actions.retry();
    expect(h.requests).toEqual([]);
    expect(h.state()).toBe(initialState);
  });
});

describe('order', () => {
  it('two messages sent at once are processed one after the other', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]), log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [11, 11, 11, 11] })])]);
    await Promise.all([h.actions.send('press 24 4 de 9'), h.actions.send('laterales 7,5 4 de 11')]);
    expect(h.requests.map((r) => r.text)).toEqual(['press 24 4 de 9', 'laterales 7,5 4 de 11']);
    expect(h.created).toHaveLength(1); // the second waited for the session the first created
  });
});
