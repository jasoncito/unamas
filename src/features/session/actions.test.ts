import seedJson from '../../../dev/seed.json';
import type { ParseRequest, ParseResponse } from '../../../shared/contract';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { getAllExercises, getExercise } from '@/data/repos/exercises';
import { getSessionEntries, insertPendingEntry, setEntryAmbiguous } from '@/data/repos/entries';
import { createSession, endSession, getOpenSession, getSession } from '@/data/repos/sessions';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { AiUnavailableError, type AiService } from '@/services/ai';

import { createSessionActions, type SessionContext, type SessionScope } from './actions';
import { initialState, sessionReducer, type SessionEvent, type SessionState } from './reducer';

const COPY = { unclear: 'No te entendí', offline: 'Sin señal', unclearRetry: (said: string) => `No entendí “${said}”` };
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

/** Photos kept as `kept/<entry>.jpg`; their base64 is the uri, so tests can see which went where. */
const fakePhotos = {
  /** The next photo's file disappears (deleted, storage cleared). */
  lose: false,
  keep(_temp: string, entryId: string) {
    return `kept/${entryId}.jpg`;
  },
  async base64(uri: string) {
    return this.lose ? null : `b64:${uri}`;
  },
};
beforeEach(() => {
  fakePhotos.lose = false;
});

/** A session screen wired to a scripted AI. */
function harness(
  answers: (ParseResponse | Error)[],
  ctx: SessionContext = { sessionId: null, groups: ['shoulders', 'triceps'] },
  scope: SessionScope = 'open',
) {
  let state: SessionState = initialState;
  const events: SessionEvent[] = [];
  const requests: ParseRequest[] = [];
  const created: string[] = [];
  let changes = 0;
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
  const dispatch = (e: SessionEvent) => {
    events.push(e);
    state = sessionReducer(state, e);
  };
  const actions = createSessionActions(
    {
      db,
      ai,
      newId: () => `f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      now: () => '2026-09-29T18:00:00.000Z',
      today: () => '2026-09-29',
      requestSync: () => void syncs++,
      photos: fakePhotos,
    },
    ctx,
    () => state,
    dispatch,
    COPY,
    { onSessionCreated: (id) => void created.push(id), onChanged: () => void changes++ },
    scope,
  );
  return { actions, ctx, events, requests, created, dispatch, state: () => state, syncs: () => syncs, changes: () => changes };
}

/** A doubt saved before its question was kept with it (migration v3): only the status says it. */
const legacyDoubt = (id: string) => db.runAsync("UPDATE entry SET status = 'ambiguous', ambiguity = NULL WHERE id = ?", [id]);
const storedAmbiguity = async (id: string) =>
  JSON.parse((await db.getFirstAsync<{ ambiguity: string | null }>('SELECT ambiguity FROM entry WHERE id = ?', [id]))!.ambiguity ?? 'null');

const entries = () => db.getAllAsync<{ id: string; status: string; exercise_id: string | null; load_kg: number | null; raw_text: string }>(
  "SELECT id, status, exercise_id, load_kg, raw_text FROM entry WHERE created_at >= '2026-09-29' ORDER BY id", []);

describe('send: the first entry', () => {
  it('creates the session at that moment, logs it and shows the delta vs. its last time', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    await h.actions.send('press de hombro 24 4 de 9');

    const session = (await getOpenSession(db))!;
    expect(session).toMatchObject({ muscleGroups: ['shoulders', 'triceps'], startedAt: '2026-09-29T18:00:00.000Z' });
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
    expect(ctx.muscle_groups).toEqual(['shoulders', 'triceps']);
    expect(ctx.exercises).toHaveLength(24);
    expect(ctx.exercises[0].muscle_groups.some((g) => ['shoulders', 'triceps'].includes(g))).toBe(true);
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
    expect(h.state()).toMatchObject({ phase: 'ready', reply: null, stopTip: 1 });
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
    const h = harness([log([entry({ load_kg: 15, reps: [12, 12, 12], new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['shoulders'], kind: 'compound', load_basis: 'total' } })])]);
    await h.actions.send('remo al mentón con barra 15 kilos 3 de 12');
    const created = (await getAllExercises(db)).find((e) => e.canonicalName === 'Remo al mentón')!;
    expect(created).toMatchObject({ aliases: ['remo al menton con barra'], kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5, loadBasis: 'total' });
    expect(h.state()).toMatchObject({ feedback: { text: 'Anotado · Remo al mentón · primera vez', tone: 'muted' } });
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

describe('retryPending (on open, on foreground, when the signal returns)', () => {
  const S = 'f0000000-0000-4000-8000-0000000000aa';
  const press = () => log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]);
  const laterales = () => log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [11, 11, 11, 11] })]);
  /** Messages saved without signal earlier in session S, a minute apart. */
  async function savedOffline(...texts: string[]) {
    await createSession(db, S, ['shoulders', 'triceps'], '2026-09-29T18:00:00.000Z');
    for (const [i, text] of texts.entries()) {
      await insertPendingEntry(db, { id: `f0000000-0000-4000-8000-00000000010${i}`, sessionId: S, rawText: text, createdAt: `2026-09-29T18:0${i}:00.000Z` });
    }
  }
  const open = (answers: (ParseResponse | Error)[]) => harness(answers, { sessionId: S, groups: ['shoulders', 'triceps'] });
  const statuses = async () => (await entries()).map((e) => [e.raw_text, e.status]);

  it('all of them, oldest first, one at a time; each pending row becomes a logged one', async () => {
    await savedOffline('press 24 4 de 9', 'laterales 7,5 4 de 11');
    const h = open([press(), laterales()]);
    await h.actions.retryPending();
    expect(h.requests.map((r) => r.text)).toEqual(['press 24 4 de 9', 'laterales 7,5 4 de 11']);
    expect(await statuses()).toEqual([['press 24 4 de 9', 'ok'], ['laterales 7,5 4 de 11', 'ok']]);
    expect(h.changes()).toBe(2);
    expect(h.syncs()).toBe(2);
  });

  it('quiet: no bubble, and what they are typing stays', async () => {
    await savedOffline('press 24 4 de 9');
    const h = open([press()]);
    h.dispatch({ type: 'TYPE', text: 'laterales' });
    await h.actions.retryPending();
    expect(h.state()).toEqual({ phase: 'ready', text: 'laterales', logged: 0, reply: null });
    expect(await statuses()).toEqual([['press 24 4 de 9', 'ok']]);
  });

  it('still no signal: it stops there and the rest wait for the next chance', async () => {
    await savedOffline('press 24 4 de 9', 'laterales 7,5 4 de 11', 'triceps 30 4 de 11');
    const h = open([press(), new AiUnavailableError('offline')]);
    await h.actions.retryPending();
    expect(h.requests).toHaveLength(2);
    expect(await statuses()).toEqual([['press 24 4 de 9', 'ok'], ['laterales 7,5 4 de 11', 'pending'], ['triceps 30 4 de 11', 'pending']]);
    expect(h.state()).toEqual(initialState); // no "Sin señal" for a retry
  });

  it('a message sent meanwhile goes between two retries, not after all of them', async () => {
    await savedOffline('press 24 4 de 9', 'laterales 7,5 4 de 11');
    const h = open([press(), log([entry({ exercise_id: ids.get('triceps_polea_tras_cabeza')!, load_kg: 30, reps: [11, 11, 11, 11] })]), laterales()]);
    const run = h.actions.retryPending();
    const sent = h.actions.send('triceps 30 4 de 11');
    await Promise.all([run, sent]);
    expect(h.requests.map((r) => r.text)).toEqual(['press 24 4 de 9', 'triceps 30 4 de 11', 'laterales 7,5 4 de 11']);
  });

  it('called again while running (foreground and signal at once): one run, each entry asked once', async () => {
    await savedOffline('press 24 4 de 9', 'laterales 7,5 4 de 11');
    const h = open([press(), laterales()]);
    await Promise.all([h.actions.retryPending(), h.actions.retryPending()]);
    expect(h.requests).toHaveLength(2);
  });

  it('foreground and signal at once with still no signal: asked once, not twice', async () => {
    await savedOffline('press 24 4 de 9');
    const h = open([new AiUnavailableError('offline')]);
    await Promise.all([h.actions.retryPending(), h.actions.retryPending()]);
    expect(h.requests).toHaveLength(1);
  });

  it('an entry of another session is asked with that session’s groups', async () => {
    const other = 'f0000000-0000-4000-8000-0000000000bb';
    await createSession(db, other, ['legs'], '2026-09-28T18:00:00.000Z');
    await insertPendingEntry(db, { id: 'f0000000-0000-4000-8000-000000000200', sessionId: other, rawText: 'sentadilla 32.5 4 de 6', createdAt: '2026-09-28T18:00:00.000Z' });
    const h = open([log([entry({ exercise_id: ids.get('sentadilla_smith')!, load_kg: 32.5, reps: [6, 6, 6, 6] })])]);
    await h.actions.retryPending();
    expect(h.requests[0].context.muscle_groups).toEqual(['legs']);
    expect(h.requests[0].context.exercises[0].muscle_groups).toContain('legs');
  });

  describe('a retried one turns out to be a doubt', () => {
    const which = (): ParseResponse => ({
      intent: 'ambiguous', entries: [], reply: null,
      ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: ids.get('laterales_polea')!, label: 'En polea' }] },
    });

    it('nothing on screen: the panel comes up', async () => {
      await savedOffline('laterales con 10, 4 de 11');
      const h = open([which()]);
      await h.actions.retryPending();
      expect(h.state()).toMatchObject({ phase: 'disambiguating', said: 'laterales con 10, 4 de 11', question: '¿Cuáles laterales?' });
    });

    it('they are typing: it waits as a doubt, and is asked on the next retry with nothing on screen', async () => {
      await savedOffline('laterales con 10, 4 de 11');
      const h = open([which(), which()]);
      h.dispatch({ type: 'TYPE', text: 'press' });
      await h.actions.retryPending();
      expect(h.state()).toMatchObject({ phase: 'ready', text: 'press' });
      expect(await statuses()).toEqual([['laterales con 10, 4 de 11', 'ambiguous']]);

      h.dispatch({ type: 'TYPE', text: '' });
      await h.actions.retryPending();
      expect(h.state()).toMatchObject({ phase: 'disambiguating', said: 'laterales con 10, 4 de 11' });
    });

    it('a doubt from before the options were kept, retried without signal, goes back to a pending row', async () => {
      await savedOffline('laterales con 10, 4 de 11');
      await legacyDoubt('f0000000-0000-4000-8000-000000000100');
      const h = open([new AiUnavailableError('offline')]);
      await h.actions.retryPending();
      expect(await statuses()).toEqual([['laterales con 10, 4 de 11', 'pending']]);
      expect(h.changes()).toBe(1);
    });

    it('the app was closed on a doubt from before the options were kept: opening asks the AI again', async () => {
      await savedOffline('laterales con 10, 4 de 11');
      await legacyDoubt('f0000000-0000-4000-8000-000000000100');
      const h = open([which()]);
      await h.actions.retryPending();
      expect(h.state()).toMatchObject({ phase: 'disambiguating', entryId: 'f0000000-0000-4000-8000-000000000100' });
    });
  });

  it('a retried one was not an entry: it goes, with a reply naming it; a session left empty goes too', async () => {
    await savedOffline('hola');
    const h = open([{ intent: 'unclear', entries: [], ambiguity: null, reply: null }]);
    await h.actions.retryPending();
    expect(await entries()).toEqual([]);
    expect(await getOpenSession(db)).toBeNull();
    expect(h.ctx.sessionId).toBeNull();
    expect(h.state()).toMatchObject({ phase: 'ready', reply: 'No entendí “hola”' });
  });

  it('not an entry while they are typing: it goes quietly, no reply over what they type', async () => {
    await savedOffline('press 24 4 de 9', 'hola');
    const h = open([press(), { intent: 'unclear', entries: [], ambiguity: null, reply: null }]);
    h.dispatch({ type: 'TYPE', text: 'laterales' });
    await h.actions.retryPending();
    expect(await statuses()).toEqual([['press 24 4 de 9', 'ok']]);
    expect(h.state()).toEqual({ phase: 'ready', text: 'laterales', logged: 0, reply: null });
  });

  it('nothing pending: nothing is sent', async () => {
    const h = harness([], { sessionId: null, groups: ['shoulders'] });
    await h.actions.retryPending();
    expect(h.requests).toEqual([]);
    expect(h.state()).toBe(initialState);
  });
});

describe('photo of a machine (design/photo.html)', () => {
  const imageOf = async (raw: string) =>
    (await db.getFirstAsync<{ image_uri: string | null }>('SELECT image_uri FROM entry WHERE raw_text = ?', [raw]))?.image_uri;
  const newMachine = (load: number, reps: number[]) =>
    log([entry({ load_kg: load, reps, new_exercise: { canonical_name: 'Press de pecho convergente', muscle_groups: ['chest'], kind: 'compound', load_basis: 'per_side' } })]);

  it('kept with the entry, sent with the text, and shown in the bubble', async () => {
    const h = harness([newMachine(25, [10, 10, 10])]);
    await h.actions.send('esta, 25 a cada lado, 3 de 10', 'cache/tmp.jpg');
    const id = (await entries())[0].id;
    expect(h.requests[0]).toMatchObject({ text: 'esta, 25 a cada lado, 3 de 10', image: `b64:kept/${id}.jpg` });
    expect(h.events[0]).toEqual({ type: 'SENT', text: 'esta, 25 a cada lado, 3 de 10', image: `kept/${id}.jpg` });
    expect(h.state()).toMatchObject({ phase: 'feedback', image: `kept/${id}.jpg`, feedback: { text: 'Anotado · Press de pecho convergente · primera vez', tone: 'muted' } });
  });

  it('a new exercise from a photo: "esta" is no alias', async () => {
    const h = harness([newMachine(25, [10, 10, 10])]);
    await h.actions.send('esta, 25 a cada lado, 3 de 10', 'cache/tmp.jpg');
    const created = (await getAllExercises(db)).find((e) => e.canonicalName === 'Press de pecho convergente')!;
    expect(created.aliases).toEqual([]);
  });

  it('photo alone: the AI names it and asks for the numbers; the answer is the whole phrase, with the photo again', async () => {
    const asks: ParseResponse = {
      intent: 'ambiguous', entries: [], reply: null,
      ambiguity: { question: 'Press de pecho convergente. ¿Con cuánto peso y cuántas series?', options: [] },
    };
    const h = harness([asks, newMachine(25, [10, 10, 10])]);
    await h.actions.send('', 'cache/tmp.jpg');
    const id = (await entries())[0].id;
    expect(h.requests[0]).toMatchObject({ text: '', image: `b64:kept/${id}.jpg` });
    expect(h.state()).toMatchObject({ phase: 'disambiguating', said: '', image: `kept/${id}.jpg` });

    await h.actions.send('25 a cada lado, 3 de 10');
    expect(h.requests[1]).toMatchObject({ text: '25 a cada lado, 3 de 10', image: `b64:kept/${id}.jpg` });
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok', raw_text: '25 a cada lado, 3 de 10' })]);
    expect(await imageOf('25 a cada lado, 3 de 10')).toBeNull(); // understood: the photo can go
  });

  it('without signal: the photo stays with the pending entry and goes again with the retry', async () => {
    const first = harness([new AiUnavailableError('offline')]);
    await first.actions.send('esta, 25 a cada lado, 3 de 10', 'cache/tmp.jpg');
    const id = (await entries())[0].id;
    expect(await imageOf('esta, 25 a cada lado, 3 de 10')).toBe(`kept/${id}.jpg`);

    const again = harness([newMachine(25, [10, 10, 10])], { sessionId: first.ctx.sessionId, groups: ['chest'] });
    await again.actions.retryPending();
    expect(again.requests[0].image).toBe(`b64:kept/${id}.jpg`);
  });

  it('choosing an option for a photo’s doubt learns no alias', async () => {
    const polea = ids.get('laterales_polea')!;
    const which: ParseResponse = {
      intent: 'ambiguous', entries: [], reply: null,
      ambiguity: { question: '¿Cuál es?', options: [{ exercise_id: polea, label: 'Laterales en polea' }] },
    };
    const h = harness([which, log([entry({ exercise_id: polea, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('esta con 10, 4 de 11', 'cache/tmp.jpg');
    const before = (await getExercise(db, polea))!.aliases;
    await h.actions.choose(polea);
    expect((await getExercise(db, polea))!.aliases).toEqual(before);
    expect(h.requests[1].image).toMatch(/^b64:kept\//);
  });

  it('a doubt answered with a photo keeps it, for a retry without signal', async () => {
    const which: ParseResponse = { intent: 'ambiguous', entries: [], reply: null, ambiguity: { question: '¿Qué máquina?', options: [] } };
    const h = harness([which, new AiUnavailableError('offline')]);
    await h.actions.send('la de pecho, 25 a cada lado, 3 de 10');
    await h.actions.send('esta', 'cache/tmp.jpg');
    const id = (await entries())[0].id;
    expect(h.requests[1].image).toBe(`b64:kept/${id}.jpg`);

    const again = harness([newMachine(25, [10, 10, 10])], { sessionId: h.ctx.sessionId, groups: ['chest'] });
    await again.actions.retryPending();
    expect(again.requests[0]).toMatchObject({ text: 'la de pecho, 25 a cada lado, 3 de 10, esta', image: `b64:kept/${id}.jpg` });
  });

  it('the photo file is gone: the text goes alone', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    fakePhotos.lose = true;
    await h.actions.send('press 24 4 de 9', 'cache/tmp.jpg');
    expect(h.requests[0].image).toBeNull();
  });
});

describe('undo ("Deshacer" during "Anotado")', () => {
  const press = () => log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]);
  const row = (id: string) =>
    db.getFirstAsync<{ deleted_at: string | null; dirty: number }>('SELECT deleted_at, dirty FROM entry WHERE id = ?', [id]);

  it('the message goes (soft: it may have synced), their words go back to the input', async () => {
    const h = harness([press(), log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('press 24 4 de 9');
    h.dispatch({ type: 'FEEDBACK_DONE' });
    await h.actions.send('laterales 7,5 4 de 11');
    const laterales = (await entries()).find((e) => e.raw_text === 'laterales 7,5 4 de 11')!;
    const syncsBefore = h.syncs();

    expect(await h.actions.undo()).toEqual({ photo: null });
    expect(h.state()).toEqual({ phase: 'ready', text: 'laterales 7,5 4 de 11', logged: 1, reply: null });
    expect(await row(laterales.id)).toMatchObject({ deleted_at: expect.any(String), dirty: 1 });
    expect(h.syncs()).toBe(syncsBefore + 1);
    expect(h.changes()).toBe(1);
    // The press, logged before, stays; so does the session.
    expect((await getSessionEntries(db, h.ctx.sessionId!)).map((e) => e.loadKg)).toEqual([24]);
    expect(await getOpenSession(db)).not.toBeNull();
  });

  it('the first entry: its session goes too, and screen 2 can go back again', async () => {
    const h = harness([press()]);
    await h.actions.send('press 24 4 de 9');
    const session = h.ctx.sessionId!;
    await h.actions.undo();
    expect(h.ctx.sessionId).toBeNull();
    expect(await getOpenSession(db)).toBeNull();
    expect(await db.getFirstAsync('SELECT deleted_at IS NOT NULL AS gone, dirty FROM session WHERE id = ?', [session])).toEqual({ gone: 1, dirty: 1 });
  });

  it('two exercises in one message: both go', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! }), entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [10, 10, 10, 10] })])]);
    await h.actions.send('press 24 4 de 9 y laterales 7,5 4 de 10');
    await h.actions.undo();
    expect(await db.getFirstAsync("SELECT count(*) AS n FROM entry WHERE created_at >= '2026-09-29' AND deleted_at IS NULL", [])).toEqual({ n: 0 });
    expect(h.state()).toMatchObject({ phase: 'ready', logged: 0 });
  });

  it('an exercise it created goes too; one that existed stays', async () => {
    const h = harness([log([entry({ load_kg: 15, reps: [12, 12, 12], new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['shoulders'], kind: 'compound', load_basis: 'total' } })])]);
    await h.actions.send('remo al mentón 15 3 de 12');
    await h.actions.undo();
    expect((await getAllExercises(db)).find((e) => e.canonicalName === 'Remo al mentón')).toBeUndefined();
    expect(await getExercise(db, ids.get('press_hombro_mancuernas')!)).not.toBeNull();
  });

  it('a doubt answered by tapping: the alias it taught goes too', async () => {
    const polea = ids.get('laterales_polea')!;
    const which: ParseResponse = { intent: 'ambiguous', entries: [], reply: null, ambiguity: { question: '¿Cuáles?', options: [{ exercise_id: polea, label: 'En polea' }] } };
    const h = harness([which, log([entry({ exercise_id: polea, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    const before = (await getExercise(db, polea))!.aliases;
    await h.actions.send('laterales con 10, 4 de 11');
    await h.actions.choose(polea);
    expect((await getExercise(db, polea))!.aliases).toContain('laterales');
    await h.actions.undo();
    expect((await getExercise(db, polea))!.aliases).toEqual(before);
  });

  it('a message with a photo: the photo comes back too', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    await h.actions.send('esta, 24, 4 de 9', 'cache/tmp.jpg');
    const id = (await entries())[0].id;
    expect(await h.actions.undo()).toEqual({ photo: `kept/${id}.jpg` });
  });

  it('only while "Anotado" is on screen, and only once', async () => {
    const h = harness([press()]);
    expect(await h.actions.undo()).toBeNull();
    await h.actions.send('press 24 4 de 9');
    h.dispatch({ type: 'FEEDBACK_DONE' });
    expect(await h.actions.undo()).toBeNull();
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok' })]);
  });

  it('a message that did not log (a doubt) leaves nothing to undo', async () => {
    const h = harness([press(), { intent: 'ambiguous', entries: [], reply: null, ambiguity: { question: '¿Con cuánto peso?', options: [] } }]);
    await h.actions.send('press 24 4 de 9');
    await h.actions.send('laterales 4 de 11'); // during "Anotado": a new message, now a doubt
    expect(await h.actions.undo()).toBeNull();
  });
});

describe('"Borrar" on a row of "Hoy"', () => {
  it('a logged entry goes (soft, synced); the session stays while it has others', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]), log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 7.5, reps: [11, 11, 11, 11] })])]);
    await h.actions.send('press 24 4 de 9');
    await h.actions.send('laterales 7,5 4 de 11');
    const lat = (await entries()).find((e) => e.raw_text === 'laterales 7,5 4 de 11')!;
    await h.actions.deleteEntry(lat.id);
    expect(await db.getFirstAsync('SELECT deleted_at IS NOT NULL AS gone, dirty FROM entry WHERE id = ?', [lat.id])).toEqual({ gone: 1, dirty: 1 });
    expect(await getOpenSession(db)).not.toBeNull();
    expect(h.changes()).toBe(1);
  });

  it('the last one: the session goes too, and a new exercise with it', async () => {
    const h = harness([log([entry({ load_kg: 15, reps: [12, 12, 12], new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['shoulders'], kind: 'compound', load_basis: 'total' } })])]);
    await h.actions.send('remo al mentón 15 3 de 12');
    await h.actions.deleteEntry((await entries())[0].id);
    expect(await getOpenSession(db)).toBeNull();
    expect(h.ctx.sessionId).toBeNull();
    expect((await getAllExercises(db)).find((e) => e.canonicalName === 'Remo al mentón')).toBeUndefined();
  });

  it('a pending row (never synced) is removed outright', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })]), new AiUnavailableError('offline')]);
    await h.actions.send('press 24 4 de 9');
    await h.actions.send('laterales 7,5 4 de 11');
    const pending = (await entries()).find((e) => e.status === 'pending')!;
    await h.actions.deleteEntry(pending.id);
    expect(await db.getFirstAsync('SELECT count(*) AS n FROM entry WHERE id = ?', [pending.id])).toEqual({ n: 0 });
  });
});

describe('an exercise of another group (backlog: gym test)', () => {
  it('chose biceps, logged a shoulder press: accepted, and shoulders joins the session', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])], { sessionId: null, groups: ['biceps'] });
    await h.actions.send('press de hombro 24 4 de 9');
    expect(await entries()).toEqual([expect.objectContaining({ status: 'ok' })]);
    expect((await getOpenSession(db))!.muscleGroups).toEqual(['biceps', 'shoulders']);
    expect(h.ctx.groups).toEqual(['biceps', 'shoulders']);
  });

  it('one of the chosen groups: nothing changes', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])], { sessionId: null, groups: ['shoulders', 'triceps'] });
    await h.actions.send('press de hombro 24 4 de 9');
    expect((await getOpenSession(db))!.muscleGroups).toEqual(['shoulders', 'triceps']);
  });

  it('an exercise of two new groups adds both, once', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('sentadilla_smith')!, load_kg: 32.5, reps: [6, 6, 6, 6] })])], { sessionId: null, groups: ['legs'] });
    await h.actions.send('sentadilla smith 32,5 4 de 6');
    expect((await getOpenSession(db))!.muscleGroups).toEqual(['legs', 'glutes']);
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

describe('end (screen 6)', () => {
  it('stops the session and shows its summary; a late answer changes nothing on screen', async () => {
    const h = harness([log([entry({ exercise_id: ids.get('press_hombro_mancuernas')! })])]);
    await h.actions.send('press 24 4 de 9');
    const summary = (await h.actions.end())!;
    expect((await getSession(db, h.ctx.sessionId!))!.endedAt).toBe('2026-09-29T18:00:00.000Z');
    expect(await getOpenSession(db)).toBeNull();
    expect(summary.tally).toEqual({ up: 1, same: 0, down: 0, new: 0 });
    expect(h.state()).toMatchObject({ phase: 'ending', summary });
    h.dispatch({ type: 'LOGGED', feedback: { text: 'x', tone: 'up' }, count: 1 });
    expect(h.state()).toMatchObject({ phase: 'ending' });
  });

  it('no session yet: nothing to end', async () => {
    expect(await harness([]).actions.end()).toBeNull();
  });
});

describe('doubts kept with their entry: shown again without the AI', () => {
  const S = 'f0000000-0000-4000-8000-0000000000aa';
  const E = 'f0000000-0000-4000-8000-000000000100';
  const open = (answers: (ParseResponse | Error)[]) => harness(answers, { sessionId: S, groups: ['shoulders', 'triceps'] });
  beforeEach(async () => {
    await createSession(db, S, ['shoulders', 'triceps'], '2026-09-29T18:00:00.000Z');
    await insertPendingEntry(db, { id: E, sessionId: S, rawText: 'laterales con 10, 4 de 11', createdAt: '2026-09-29T18:00:00.000Z' });
  });

  it('when /parse asks, the question and the options it could name are kept with the entry', async () => {
    const polea = ids.get('laterales_polea')!;
    const first = harness([{ intent: 'ambiguous', entries: [], reply: null, ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: polea, label: 'En polea' }, { exercise_id: 'invented', label: 'Inventado' }] } }], { sessionId: S, groups: ['shoulders'] });
    await first.actions.send('laterales con 12, 4 de 10');
    const asked = (await entries()).find((e) => e.raw_text === 'laterales con 12, 4 de 10')!;
    expect(await storedAmbiguity(asked.id)).toEqual({ question: '¿Cuáles laterales?', options: [{ exerciseId: polea, label: 'En polea' }] });
  });

  it('the app reopened on it: the same question, no call, and without signal too', async () => {
    const polea = ids.get('laterales_polea')!;
    await setEntryAmbiguous(db, E, { question: '¿Cuáles laterales?', options: [{ exerciseId: polea, label: 'En polea' }] });
    const h = open([]); // any call would fail: no scripted answer
    await h.actions.retryPending();
    expect(h.requests).toEqual([]);
    expect(h.state()).toMatchObject({
      phase: 'disambiguating',
      entryId: E,
      question: '¿Cuáles laterales?',
      options: [{ exerciseId: polea, label: 'En polea', lastLoadKg: 7.5 }],
    });
  });

  it('the last load on each button is as of now, not as when it was asked', async () => {
    const polea = ids.get('laterales_polea')!;
    await setEntryAmbiguous(db, E, { question: '¿Cuáles laterales?', options: [{ exerciseId: polea, label: 'En polea' }] });
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
       VALUES ('f0000000-0000-4000-8000-000000000101', ?, ?, 8.75, '[10,10,10,10]', 'x', 'ok', '2026-09-29T18:30:00.000Z', '2026-09-29T18:30:00.000Z', 1)`,
      [S, polea],
    );
    const h = open([]);
    await h.actions.retryPending();
    expect(h.state()).toMatchObject({ options: [{ lastLoadKg: 8.75 }] });
  });

  it('"¿Con cuánto peso?" (no options) is shown again the same way', async () => {
    await setEntryAmbiguous(db, E, { question: '¿Con cuánto peso?', options: [] });
    const h = open([]);
    await h.actions.retryPending();
    expect(h.state()).toMatchObject({ phase: 'disambiguating', question: '¿Con cuánto peso?', options: [] });
  });

  it('its exercises were deleted since: it is asked anew', async () => {
    await setEntryAmbiguous(db, E, { question: '¿Cuáles laterales?', options: [{ exerciseId: 'f0000000-0000-4000-8000-00000000dead', label: 'Borrado' }] });
    const h = open([log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.retryPending();
    expect(h.requests).toHaveLength(1);
    expect(await storedAmbiguity(E)).toBeNull();
  });

  it('answered: the kept question is dropped', async () => {
    const polea = ids.get('laterales_polea')!;
    await setEntryAmbiguous(db, E, { question: '¿Cuáles laterales?', options: [{ exerciseId: polea, label: 'En polea' }] });
    const h = open([log([entry({ exercise_id: polea, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.retryPending();
    await h.actions.choose(polea);
    expect(h.requests).toHaveLength(1); // only the answer is parsed
    expect(await storedAmbiguity(E)).toBeNull();
  });
});

describe('closed sessions (retried from the root; doubts on screen 1)', () => {
  const S = 'f0000000-0000-4000-8000-0000000000aa';
  const E1 = 'f0000000-0000-4000-8000-000000000301';
  const which = (): ParseResponse => ({
    intent: 'ambiguous', entries: [], reply: null,
    ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: ids.get('laterales_polea')!, label: 'En polea' }] },
  });
  const root = (answers: (ParseResponse | Error)[]) => harness(answers, { sessionId: null, groups: [] }, 'ended');
  beforeEach(async () => {
    await createSession(db, S, ['shoulders', 'triceps'], '2026-09-28T18:00:00.000Z');
    await insertPendingEntry(db, { id: E1, sessionId: S, rawText: 'laterales con 10, 4 de 11', createdAt: '2026-09-28T18:00:00.000Z' });
    await endSession(db, S, '2026-09-28T19:00:00.000Z');
  });

  it('a pending one of a stopped session is retried with its groups and logged in that session', async () => {
    const h = root([log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.retryPending();
    expect(h.requests[0].context.muscle_groups).toEqual(['shoulders', 'triceps']);
    expect(await db.getFirstAsync('SELECT status, session_id FROM entry WHERE id = ?', [E1])).toEqual({ status: 'ok', session_id: S });
  });

  it('the session screen leaves them alone', async () => {
    const h = harness([]);
    await h.actions.retryPending();
    expect(h.requests).toEqual([]);
  });

  it('it turns out ambiguous: the question comes up, and the answer goes to that stopped session', async () => {
    const polea = ids.get('laterales_polea')!;
    const h = root([which(), log([entry({ exercise_id: polea, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.retryPending();
    expect(h.state()).toMatchObject({ phase: 'disambiguating', entryId: E1, question: '¿Cuáles laterales?' });

    await h.actions.choose(polea);
    expect(h.requests[1].context.muscle_groups).toEqual(['shoulders', 'triceps']);
    expect(await db.getFirstAsync('SELECT status, session_id, exercise_id FROM entry WHERE id = ?', [E1])).toEqual({ status: 'ok', session_id: S, exercise_id: polea });
    expect(await getOpenSession(db)).toBeNull(); // no new session
  });

  it('typed answer ("U otra cosa") also goes to the stopped session', async () => {
    const h = root([which(), log([entry({ exercise_id: ids.get('laterales_polea')!, load_kg: 10, reps: [11, 11, 11, 11] })])]);
    await h.actions.retryPending();
    await h.actions.send('en polea');
    expect(h.requests[1].text).toBe('laterales con 10, 4 de 11 (en polea)');
    expect(await db.getFirstAsync('SELECT status, session_id FROM entry WHERE id = ?', [E1])).toEqual({ status: 'ok', session_id: S });
    expect(await getOpenSession(db)).toBeNull();
  });

  it('a doubt left from before is asked on open, without the AI; "Ahora no" puts it off until the app opens again', async () => {
    await setEntryAmbiguous(db, E1, { question: '¿Cuáles laterales?', options: [{ exerciseId: ids.get('laterales_polea')!, label: 'En polea' }] });
    const h = root([]);
    await h.actions.retryPending();
    expect(h.state()).toMatchObject({ phase: 'disambiguating', entryId: E1 });
    h.actions.dismissDoubt();
    expect(h.state()).toMatchObject({ phase: 'ready' });
    await h.actions.retryPending(); // foreground: not asked again
    expect(h.state()).toMatchObject({ phase: 'ready' });
    expect(await statusOf(E1)).toBe('ambiguous');

    const reopened = root([]);
    await reopened.actions.retryPending();
    expect(reopened.state()).toMatchObject({ phase: 'disambiguating', entryId: E1 });
    expect([...h.requests, ...reopened.requests]).toEqual([]);
  });

  it('screen 1 doesn\'t take new entries: only answers', async () => {
    const h = root([]);
    await h.actions.send('press 24 4 de 9');
    expect(h.requests).toEqual([]);
    expect(await getOpenSession(db)).toBeNull();
    expect(h.state()).toBe(initialState);
  });

  const statusOf = async (id: string) => (await db.getFirstAsync<{ status: string }>('SELECT status FROM entry WHERE id = ?', [id]))!.status;
});
