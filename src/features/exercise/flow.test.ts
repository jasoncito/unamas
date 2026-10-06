import seedJson from '../../../dev/seed.json';
import type { ParseRequest, ParseResponse } from '../../../shared/contract';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { getAllExercises } from '@/data/repos/exercises';
import { getDrafts, getSessionEntries } from '@/data/repos/entries';
import { createSession, getOpenSession, getSession } from '@/data/repos/sessions';
import { loadSeed, type Seed } from '@/data/seed';
import { FakeServer } from '@/data/testing/fakeServer';
import { openMemoryDb } from '@/data/testing/memoryDb';
import { sync } from '@/data/sync';
import { AiUnavailableError, type AiService } from '@/services/ai';
import { createSessionActions } from '@/features/session/actions';
import { initialState, sessionReducer, type SessionState } from '@/features/session/reducer';
import { loadSessionScreen, type ListRow } from '@/features/session/controller';

import { createFlowActions, loadExerciseView } from './actions';
import { flowReducer, initialFlow, MAX_SETS, type FlowEvent, type FlowState } from './flow';

// ─── The state machine, pure ─────────────────────────────────────────────────────────────────────

const run = (events: FlowEvent[], from: FlowState = initialFlow) => events.reduce(flowReducer, from);

describe('flowReducer', () => {
  it('list → weight → training → reps → list', () => {
    expect(run([{ type: 'PICK', exerciseId: 'x' }])).toEqual({ screen: 'weight', exerciseId: 'x', draft: null });
    const training = run([{ type: 'PICK', exerciseId: 'x' }, { type: 'STARTED', draftId: 'd', loadKg: 32.5 }]);
    expect(training).toEqual({ screen: 'training', exerciseId: 'x', draftId: 'd', loadKg: 32.5 });
    const reps = flowReducer(training, { type: 'DONE', reps: [6, 6, 6, 6] });
    expect(reps).toEqual({ screen: 'reps', exerciseId: 'x', draftId: 'd', loadKg: 32.5, reps: [6, 6, 6, 6] });
    expect(flowReducer(reps, { type: 'SAVED' })).toEqual({ screen: 'list' });
  });

  it('cambiar peso: back to the selector with the draft and its load; starting again keeps the draft', () => {
    const training: FlowState = { screen: 'training', exerciseId: 'x', draftId: 'd', loadKg: 32.5 };
    const weight = flowReducer(training, { type: 'CHANGE_WEIGHT' });
    expect(weight).toEqual({ screen: 'weight', exerciseId: 'x', draft: { id: 'd', loadKg: 32.5 } });
    expect(flowReducer(weight, { type: 'STARTED', draftId: 'd', loadKg: 30 })).toEqual({ ...training, loadKg: 30 });
    // "‹" while changing it: back to the draft as it was.
    expect(flowReducer(weight, { type: 'BACK' })).toEqual(training);
  });

  it('‹ goes one screen back: reps → training → list; a new weight → list', () => {
    const reps: FlowState = { screen: 'reps', exerciseId: 'x', draftId: 'd', loadKg: 30, reps: [9] };
    expect(flowReducer(reps, { type: 'BACK' })).toEqual({ screen: 'training', exerciseId: 'x', draftId: 'd', loadKg: 30 });
    expect(run([{ type: 'BACK' }, { type: 'BACK' }], reps)).toEqual(initialFlow);
    expect(run([{ type: 'PICK', exerciseId: 'x' }, { type: 'BACK' }])).toEqual(initialFlow);
    expect(flowReducer(initialFlow, { type: 'BACK' })).toBe(initialFlow);
  });

  it('a draft resumes on screen 3, only from the list', () => {
    const resume: FlowEvent = { type: 'RESUME', exerciseId: 'x', draftId: 'd', loadKg: 30 };
    expect(flowReducer(initialFlow, resume)).toEqual({ screen: 'training', exerciseId: 'x', draftId: 'd', loadKg: 30 });
    const weight: FlowState = { screen: 'weight', exerciseId: 'y', draft: null };
    expect(flowReducer(weight, resume)).toBe(weight);
  });

  it('the rows: change one, add a set like the last one, remove one but never the last', () => {
    const reps: FlowState = { screen: 'reps', exerciseId: 'x', draftId: 'd', loadKg: 30, reps: [8, 8, 7] };
    expect(run([{ type: 'SET_REP', index: 2, reps: 8 }], reps)).toMatchObject({ reps: [8, 8, 8] });
    expect(run([{ type: 'SET_REP', index: 0, reps: 0 }], reps)).toMatchObject({ reps: [1, 8, 7] });
    expect(run([{ type: 'SET_REP', index: 0, reps: 120 }], reps)).toMatchObject({ reps: [99, 8, 7] });
    expect(run([{ type: 'SET_REP', index: 5, reps: 3 }], reps)).toBe(reps);
    expect(run([{ type: 'ADD_SET' }], reps)).toMatchObject({ reps: [8, 8, 7, 7] });
    expect(run([{ type: 'REMOVE_SET', index: 0 }], reps)).toMatchObject({ reps: [8, 7] });
    expect(run([{ type: 'REMOVE_SET', index: 0 }, { type: 'REMOVE_SET', index: 0 }, { type: 'REMOVE_SET', index: 0 }], reps)).toMatchObject({ reps: [7] });
    expect(run(Array(30).fill({ type: 'ADD_SET' }), reps)).toMatchObject({ reps: expect.any(Array) });
    expect((run(Array(30).fill({ type: 'ADD_SET' }), reps) as { reps: number[] }).reps).toHaveLength(MAX_SETS);
  });

  it('what they said replaces the rows; nothing understood leaves them', () => {
    const reps: FlowState = { screen: 'reps', exerciseId: 'x', draftId: 'd', loadKg: 30, reps: [8, 8, 8, 8] };
    expect(run([{ type: 'FILL', reps: [8, 8, 7] }], reps)).toMatchObject({ reps: [8, 8, 7] });
    expect(run([{ type: 'FILL', reps: [] }], reps)).toBe(reps);
  });

  it('events from another screen change nothing', () => {
    expect(flowReducer(initialFlow, { type: 'DONE', reps: [1] })).toBe(initialFlow);
    expect(flowReducer(initialFlow, { type: 'SAVED' })).toBe(initialFlow);
    expect(flowReducer(initialFlow, { type: 'STARTED', draftId: 'd', loadKg: 1 })).toBe(initialFlow);
  });
});

// ─── With the database: the draft is saved at every step ────────────────────────────────────────

let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
});

const TODAY = '2026-09-29';
const smith = () => ids.get('sentadilla_smith')!;

/** The session screen's actions and the flow's, wired together as the screen does it. */
function harness(answers: (ParseResponse | Error)[] = [], sessionId: string | null = null) {
  let flow: FlowState = initialFlow;
  let session: SessionState = initialState;
  let n = 0;
  let syncs = 0;
  const requests: ParseRequest[] = [];
  const ai: AiService = {
    async parse(req) {
      requests.push(req);
      const a = answers.shift();
      if (!a) throw new Error('no scripted answer');
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const deps = {
    db,
    ai,
    newId: () => `f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => `2026-09-29T18:${String(n).padStart(2, '0')}:00.000Z`,
    today: () => TODAY,
    requestSync: () => void syncs++,
  };
  const sessionActions = createSessionActions(
    { ...deps, photos: { keep: () => '', base64: async () => null } },
    { sessionId, groups: ['legs'], startedAt: '2026-09-29T17:55:00.000Z' },
    () => session,
    (e) => void (session = sessionReducer(session, e)),
    { unclear: '', offline: '', unclearRetry: () => '' },
    { onSessionCreated: () => {}, onChanged: () => {} },
  );
  const actions = createFlowActions(deps, sessionActions, () => flow, (e) => void (flow = flowReducer(flow, e)));
  return { actions, sessionActions, flow: () => flow, requests, syncs: () => syncs };
}

const entryRow = (id: string) =>
  db.getFirstAsync<{ status: string; load_kg: number; reps: string | null; dirty: number; created_at: string }>(
    'SELECT status, load_kg, reps, dirty, created_at FROM entry WHERE id = ?',
    [id],
  );

const rowsOf = async () => {
  const s = (await loadSessionScreen(db, TODAY, ['legs']))!;
  return s.sections[0].rows.map((r: ListRow) =>
    r.kind === 'todo' ? ['todo', r.line.name] : r.kind === 'draft' ? ['en curso', r.name, r.draft.loadKg] : ['hecho', r.line.name, r.line.reps],
  );
};

describe('the flow with its draft', () => {
  it('Empezar creates the session (EMPEZAR’s time) and a draft with the load and no reps, never dirty', async () => {
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    const flow = h.flow();
    expect(flow).toMatchObject({ screen: 'training', exerciseId: smith(), loadKg: 32.5 });
    const open = (await getOpenSession(db))!;
    expect(open.startedAt).toBe('2026-09-29T17:55:00.000Z');
    const draftId = (flow as { draftId: string }).draftId;
    expect(await entryRow(draftId)).toMatchObject({ status: 'draft', load_kg: 32.5, reps: null, dirty: 0 });
  });

  it('lista → peso → entrenando → reps → lista: saved as a normal entry, with its comparison on the list', async () => {
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    await h.actions.done();
    // More load than last time (30 × 4×10): the floor, as many sets as last time.
    expect(h.flow()).toMatchObject({ screen: 'reps', reps: [6, 6, 6, 6] });
    await h.actions.interpret('3 de 8 y una de 7');
    expect(h.flow()).toMatchObject({ reps: [8, 8, 8, 7] });
    const { draftId } = h.flow() as { draftId: string };
    await h.actions.save();
    expect(h.flow()).toEqual({ screen: 'list' });
    expect(await entryRow(draftId)).toMatchObject({ status: 'ok', load_kg: 32.5, reps: '[8,8,8,7]', dirty: 1 });
    expect(h.syncs()).toBe(1);
    expect(h.requests).toEqual([]); // read locally: no AI
    const rows = await rowsOf();
    expect(rows.at(-1)).toEqual(['hecho', 'Sentadilla en máquina Smith', [8, 8, 8, 7]]);
    const done = (await loadSessionScreen(db, TODAY, ['legs']))!.sections[0].rows.at(-1)!;
    expect(done.kind === 'done' && [done.line.delta.kind, done.line.delta.kind === 'load' && done.line.delta.tone]).toEqual(['load', 'up']);
  });

  it('cambiar peso updates the same draft', async () => {
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    const { draftId } = h.flow() as { draftId: string };
    h.actions.changeWeight();
    expect(h.flow()).toEqual({ screen: 'weight', exerciseId: smith(), draft: { id: draftId, loadKg: 32.5 } });
    await h.actions.start(30);
    expect(h.flow()).toMatchObject({ screen: 'training', draftId, loadKg: 30 });
    expect(await entryRow(draftId)).toMatchObject({ status: 'draft', load_kg: 30 });
    expect(await db.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM entry WHERE status = 'draft'", [])).toEqual({ n: 1 });
    // Same load as last time: +1 per set, up to the top (10).
    await h.actions.done();
    expect(h.flow()).toMatchObject({ reps: [10, 10, 10, 10] });
  });

  it('volver con ‹ keeps the draft: the row says "en curso" and tapping it goes back to screen 3', async () => {
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    const { draftId } = h.flow() as { draftId: string };
    h.actions.back();
    expect(h.flow()).toEqual({ screen: 'list' });
    expect(await rowsOf()).toEqual([
      ['en curso', 'Sentadilla en máquina Smith', 32.5],
      ['todo', 'Zancadas alternas con barra'],
      ['todo', 'Extensión de pierna'],
    ]);
    expect(await h.actions.resume(draftId)).toBe(true);
    expect(h.flow()).toEqual({ screen: 'training', exerciseId: smith(), draftId, loadKg: 32.5 });
  });

  it('reabrir con draft: the app comes back to screen 3 of the latest draft', async () => {
    const first = harness();
    first.actions.pick(smith());
    await first.actions.start(32.5);
    // The app closes and opens again: a new screen for the open session.
    const sessionId = (await getOpenSession(db))!.id;
    const again = harness([], sessionId);
    expect(again.flow()).toEqual(initialFlow);
    expect(await again.actions.resume()).toBe(true);
    expect(again.flow()).toMatchObject({ screen: 'training', exerciseId: smith(), loadKg: 32.5 });
  });

  it('without a draft there is nothing to reopen', async () => {
    await createSession(db, 'f0000000-0000-4000-8000-0000000000aa', ['legs'], '2026-09-29T17:00:00.000Z');
    const h = harness([], 'f0000000-0000-4000-8000-0000000000aa');
    expect(await h.actions.resume()).toBe(false);
    expect(await harness().actions.resume()).toBe(false); // no session row yet
  });

  it('what the local reader can’t read goes to /parse with the exercise and the load fixed', async () => {
    const h = harness([
      { intent: 'log', entries: [{ exercise_id: smith(), new_exercise: null, load_kg: 32.5, reps: [8, 8, 6], rir_note: null, easy: false }], ambiguity: null, reply: null },
    ]);
    h.actions.pick(smith());
    await h.actions.start(32.5);
    await h.actions.done();
    expect(await h.actions.interpret('ocho, ocho y al final seis')).toBe('filled');
    expect(h.flow()).toMatchObject({ reps: [8, 8, 6] });
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].text).toBe('Sentadilla en máquina Smith, 32.5 kg, ocho, ocho y al final seis');
    expect(h.requests[0].context.exercises.map((e) => e.id)).toEqual([smith()]);
  });

  it('/parse not understanding it, or no signal, leaves the rows as they were', async () => {
    const h = harness([{ intent: 'unclear', entries: [], ambiguity: null, reply: null }, new AiUnavailableError('offline')]);
    h.actions.pick(smith());
    await h.actions.start(32.5);
    await h.actions.done();
    expect(await h.actions.interpret('no sé')).toBe('unclear');
    expect(await h.actions.interpret('no sé')).toBe('offline');
    expect(h.flow()).toMatchObject({ reps: [6, 6, 6, 6] });
  });

  it('drafts never sync; once saved, the entry and its session go up', async () => {
    const server = new FakeServer();
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    await sync(db, server.store());
    const sessionId = (await getOpenSession(db))!.id;
    expect(server.rows.session.has(sessionId)).toBe(false);
    expect([...server.rows.entry.values()].some((r) => r.status === 'draft')).toBe(false);
    await h.actions.done();
    await h.actions.save();
    await sync(db, server.store());
    expect(server.rows.session.has(sessionId)).toBe(true);
    expect([...server.rows.entry.values()].filter((r) => r.session_id === sessionId).map((r) => r.status)).toEqual(['ok']);
  });

  it('ending the session drops an open draft; a session with only a draft has nothing to end', async () => {
    const h = harness();
    h.actions.pick(smith());
    await h.actions.start(32.5);
    expect((await loadSessionScreen(db, TODAY, null))!.hasEntries).toBe(false);
    await h.actions.done();
    await h.actions.save();
    h.actions.pick(ids.get('zancadas_barra')!);
    await h.actions.start(10);
    const sessionId = (await getOpenSession(db))!.id;
    expect(await h.sessionActions.end()).not.toBeNull();
    expect(await getDrafts(db, sessionId)).toEqual([]);
    expect((await getSession(db, sessionId))!.endedAt).not.toBeNull();
    expect((await getSessionEntries(db, sessionId)).map((e) => e.exerciseId)).toEqual([smith()]);
  });

  it('the exercise view: last time is its last session’s best entry, and the engine’s target', async () => {
    const view = (await loadExerciseView(db, smith(), TODAY))!;
    expect(view.last).toEqual({ date: '2026-09-24', loadKg: 30, reps: [10, 10, 10, 10] });
    expect(view.suggestion).toEqual({ loadKg: 32.5, reps: [6, 6, 6, 6] });
    expect((await getAllExercises(db)).length).toBeGreaterThan(0);
  });
});
