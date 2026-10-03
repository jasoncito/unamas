import seedJson from '../../dev/seed.json';

import type { Db } from './db';
import { initDb } from './init';
import {
  deleteUnsyncedEntry,
  getExerciseHistory,
  getSessionEntries,
  getAllPendingEntries,
  getDoubtEntry,
  getEndedSessionDoubt,
  insertPendingEntry,
  resolveEntry,
  setEntryRawText,
  setEntryAmbiguous,
  setEntryPending,
  deleteEntries,
} from './repos/entries';
import { deleteExerciseIfUnused, insertExercise } from './repos/exercises';
import { createSession, deleteSessionIfEmpty, deleteSessionIfNoEntries, endSession, endStaleSessions, getOpenSession } from './repos/sessions';
import { loadSeed, type Seed } from './seed';
import { sync, TABLES } from './sync';
import { FakeServer } from './testing/fakeServer';
import { openMemoryDb } from './testing/memoryDb';

const S = 'f0000000-0000-4000-8000-0000000000a1';
const ASK = { question: '¿Cuáles laterales?', options: [{ exerciseId: 'x', label: 'En polea' }] };
const E = 'f0000000-0000-4000-8000-0000000000e1';
let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
  await createSession(db, S, ['shoulders'], '2026-09-29T18:00:00.000Z');
  await insertPendingEntry(db, { id: E, sessionId: S, rawText: 'press de hombro 24 4 de 9, fácil', createdAt: '2026-09-29T18:00:00.000Z' });
});

const row = (id = E) =>
  db.getFirstAsync<{ status: string; exercise_id: string | null; load_kg: number | null; easy: number; raw_text: string; dirty: number; ambiguity: string | null }>(
    'SELECT status, exercise_id, load_kg, easy, raw_text, dirty, ambiguity FROM entry WHERE id = ?',
    [id],
  );

describe('entry lifecycle (screen 4)', () => {
  it('a pending entry has the text and nothing else yet, and is waiting to be retried', async () => {
    expect(await row()).toMatchObject({ status: 'pending', exercise_id: null, load_kg: null, raw_text: 'press de hombro 24 4 de 9, fácil' });
    expect(await getAllPendingEntries(db, 'open')).toEqual([{ id: E, rawText: 'press de hombro 24 4 de 9, fácil', sessionId: S, groups: ['shoulders'], ambiguity: null, imageUri: null }]);
    expect(await getDoubtEntry(db, S)).toBeNull();
  });

  it('pending ones from every session come oldest first; a doubt or a deleted one is not retried', async () => {
    const S2 = 'f0000000-0000-4000-8000-0000000000a2';
    await createSession(db, S2, ['legs'], '2026-09-28T18:00:00.000Z');
    const add = (id: string, session: string, at: string) =>
      insertPendingEntry(db, { id: `f0000000-0000-4000-8000-0000000000${id}`, sessionId: session, rawText: id, createdAt: at });
    await add('e2', S2, '2026-09-28T18:00:00.000Z');
    await add('e3', S, '2026-09-29T19:00:00.000Z');
    await add('e4', S, '2026-09-29T19:30:00.000Z');
    await add('e5', S, '2026-09-29T20:00:00.000Z');
    await setEntryAmbiguous(db, 'f0000000-0000-4000-8000-0000000000e4', ASK);
    await db.runAsync("UPDATE entry SET deleted_at = '2026-09-29T21:00:00Z' WHERE id = ?", ['f0000000-0000-4000-8000-0000000000e5']);
    expect((await getAllPendingEntries(db, 'open')).map((e) => [e.rawText, e.groups])).toEqual([
      ['e2', ['legs']],
      ['press de hombro 24 4 de 9, fácil', ['shoulders']],
      ['e3', ['shoulders']],
    ]);
  });

  it('resolving stores exercise, numbers, note and easy, ready to sync', async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    await resolveEntry(db, E, { exerciseId: press, loadKg: 24, reps: [9, 9, 9, 9], rirNote: 'fácil', easy: true });
    expect(await row()).toMatchObject({ status: 'ok', exercise_id: press, load_kg: 24, easy: 1, dirty: 1 });
    expect(await getAllPendingEntries(db, 'open')).toEqual([]);
    const history = await getExerciseHistory(db, press);
    expect(history.at(-1)).toMatchObject({ loadKg: 24, reps: [9, 9, 9, 9], easy: true });
    expect(history[0].easy).toBe(false);
  });

  it('pending and doubts split by whether their session was stopped', async () => {
    const S2 = 'f0000000-0000-4000-8000-0000000000a2';
    await createSession(db, S2, ['legs'], '2026-09-28T18:00:00.000Z');
    const at = (id: string, t: string) => insertPendingEntry(db, { id: `f0000000-0000-4000-8000-0000000000${id}`, sessionId: S2, rawText: id, createdAt: t });
    await at('e2', '2026-09-28T18:00:00.000Z');
    await at('e3', '2026-09-28T18:05:00.000Z');
    await at('e4', '2026-09-28T18:10:00.000Z');
    await setEntryAmbiguous(db, 'f0000000-0000-4000-8000-0000000000e3', ASK);
    await setEntryAmbiguous(db, 'f0000000-0000-4000-8000-0000000000e4', ASK);
    await endSession(db, S2, '2026-09-28T19:00:00.000Z');

    expect((await getAllPendingEntries(db, 'open')).map((e) => e.sessionId)).toEqual([S]);
    expect((await getAllPendingEntries(db, 'ended')).map((e) => e.rawText)).toEqual(['e2']);
    expect(await getEndedSessionDoubt(db)).toMatchObject({ rawText: 'e3', sessionId: S2, groups: ['legs'] });
    expect(await getEndedSessionDoubt(db, ['f0000000-0000-4000-8000-0000000000e3'])).toMatchObject({ rawText: 'e4' });
    expect(await getDoubtEntry(db, S)).toBeNull();
    expect(await getOpenSession(db)).toMatchObject({ id: S });
  });

  it('a doubt keeps its question and options; answering it, or resolving it, drops them', async () => {
    await setEntryAmbiguous(db, E, ASK);
    expect(await getDoubtEntry(db, S)).toMatchObject({ id: E, ambiguity: ASK });
    expect((await row())!.status).toBe('ambiguous');

    await setEntryPending(db, E);
    expect(await row()).toMatchObject({ status: 'pending', ambiguity: null });

    await setEntryAmbiguous(db, E, ASK);
    await resolveEntry(db, E, { exerciseId: ids.get('laterales_polea')!, loadKg: 10, reps: [11, 11, 11, 11], rirNote: null, easy: false });
    expect(await row()).toMatchObject({ status: 'ok', ambiguity: null });
  });

  it('the question never goes up: it is not among the synced columns', () => {
    expect(TABLES.entry.columns).not.toContain('ambiguity');
  });

  it('ambiguous, then their answer joins the phrase', async () => {
    await setEntryAmbiguous(db, E, ASK);
    await setEntryRawText(db, E, 'press de hombro 24 4 de 9, fácil (con mancuernas)');
    expect(await getDoubtEntry(db, S)).toMatchObject({ id: E, rawText: 'press de hombro 24 4 de 9, fácil (con mancuernas)' });
    expect(await getAllPendingEntries(db, 'open')).toEqual([]);
  });

  it('a message that was not an entry is removed; a logged entry never is', async () => {
    await deleteUnsyncedEntry(db, E);
    expect(await row()).toBeNull();
    await deleteUnsyncedEntry(db, ids.get('s5e1')!);
    expect(await row(ids.get('s5e1')!)).not.toBeNull();
  });

  it("the session's entries: only logged ones, oldest first", async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    await resolveEntry(db, E, { exerciseId: press, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false });
    const E2 = 'f0000000-0000-4000-8000-0000000000e2';
    await insertPendingEntry(db, { id: E2, sessionId: S, rawText: 'laterales 10', createdAt: '2026-09-29T18:05:00.000Z' });
    expect((await getSessionEntries(db, S)).map((e) => [e.id, e.exerciseId, e.loadKg])).toEqual([[E, press, 24]]);
  });
});

describe('easy through sync', () => {
  it('goes up as a boolean and comes down as 0/1', async () => {
    await resolveEntry(db, E, { exerciseId: ids.get('press_hombro_mancuernas')!, loadKg: 24, reps: [9, 9, 9, 9], rirNote: 'fácil', easy: true });
    const server = new FakeServer();
    await sync(db, server.store());
    expect(server.rows.entry.get(E)!.easy).toBe(true);
    expect([...server.rows.entry.values()].filter((r) => r.easy === false)).toHaveLength(32);

    const other = openMemoryDb();
    await initDb(other, null);
    await sync(other, server.store());
    expect((await other.getFirstAsync<{ easy: number }>('SELECT easy FROM entry WHERE id = ?', [E]))!.easy).toBe(1);
  });
});

describe('empty sessions', () => {
  it('a session with only a pending entry does not sync; once it has a logged entry, it does', async () => {
    const server = new FakeServer();
    await sync(db, server.store());
    expect(server.rows.session.has(S)).toBe(false);
    await resolveEntry(db, E, { exerciseId: ids.get('press_hombro_mancuernas')!, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false });
    await sync(db, server.store());
    expect(server.rows.session.has(S)).toBe(true);
  });

  it('deleteSessionIfEmpty removes it only when no entry is left', async () => {
    expect(await deleteSessionIfEmpty(db, S)).toBe(false);
    await deleteUnsyncedEntry(db, E);
    expect(await deleteSessionIfEmpty(db, S)).toBe(true);
    expect(await getOpenSession(db)).toBeNull();
  });
});

describe('undo through sync ("Deshacer" after the entry went up)', () => {
  it('the entry, its new exercise and its empty session are deleted on the server and on another phone', async () => {
    const NEW = 'f0000000-0000-4000-8000-0000000000c1';
    await insertExercise(db, {
      id: NEW, canonicalName: 'Remo al mentón', aliases: [], muscleGroups: ['shoulders'], kind: 'compound',
      repFloor: 8, repTop: 12, stepKg: 2.5, loadBasis: 'total', createdAt: '2026-09-29T18:00:00.000Z',
    });
    await resolveEntry(db, E, { exerciseId: NEW, loadKg: 15, reps: [12, 12, 12], rirNote: null, easy: false });
    const server = new FakeServer();
    await sync(db, server.store()); // it went up within seconds
    expect(server.rows.entry.get(E)!.deleted_at).toBeNull();

    await deleteEntries(db, [E]);
    expect(await deleteExerciseIfUnused(db, NEW)).toBe(true);
    expect(await deleteSessionIfNoEntries(db, S)).toBe(true);
    await sync(db, server.store());
    expect([server.rows.entry.get(E)!.deleted_at, server.rows.exercise.get(NEW)!.deleted_at, server.rows.session.get(S)!.deleted_at]).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);

    const other = openMemoryDb();
    await initDb(other, null);
    await sync(other, server.store());
    expect(await other.getFirstAsync('SELECT count(*) AS n FROM entry WHERE id = ? AND deleted_at IS NULL', [E])).toEqual({ n: 0 });
    expect(await getOpenSession(other)).toBeNull();
  });

  it('an exercise still used elsewhere, or a session with other entries, stay', async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    await resolveEntry(db, E, { exerciseId: press, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false });
    await insertPendingEntry(db, { id: 'f0000000-0000-4000-8000-0000000000e2', sessionId: S, rawText: 'otro', createdAt: '2026-09-29T18:05:00.000Z' });
    await deleteEntries(db, [E]);
    expect(await deleteExerciseIfUnused(db, press)).toBe(false); // the seed's history uses it
    expect(await deleteSessionIfNoEntries(db, S)).toBe(false);
  });
});

describe('sessions left open (M8)', () => {
  const at = (iso: string, id: string) =>
    insertPendingEntry(db, { id, sessionId: S, rawText: 'x', createdAt: iso }).then(() =>
      resolveEntry(db, id, { exerciseId: ids.get('press_hombro_mancuernas')!, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false }),
    );

  it('no entry for 4 h: closed, ending at its last entry', async () => {
    await resolveEntry(db, E, { exerciseId: ids.get('press_hombro_mancuernas')!, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false });
    await at('2026-09-29T18:40:00.000Z', 'f0000000-0000-4000-8000-0000000000e9');
    expect(await endStaleSessions(db, '2026-09-29T22:39:00.000Z')).toBe(0); // 3 h 59 min: still going
    expect(await endStaleSessions(db, '2026-09-29T22:41:00.000Z')).toBe(1);
    expect(await getOpenSession(db)).toBeNull();
    expect(await db.getFirstAsync('SELECT ended_at, dirty FROM session WHERE id = ?', [S])).toEqual({ ended_at: '2026-09-29T18:40:00.000Z', dirty: 1 });
  });

  it('an ended session is left alone', async () => {
    await endSession(db, S, '2026-09-29T19:00:00.000Z');
    expect(await endStaleSessions(db, '2026-09-30T19:00:00.000Z')).toBe(0);
    expect(await db.getFirstAsync('SELECT ended_at FROM session WHERE id = ?', [S])).toEqual({ ended_at: '2026-09-29T19:00:00.000Z' });
  });
});

describe('chosen groups (local only)', () => {
  it('kept on this phone: they never go up, and a pull leaves them alone', async () => {
    await resolveEntry(db, E, { exerciseId: ids.get('press_hombro_mancuernas')!, loadKg: 24, reps: [9, 9, 9, 9], rirNote: null, easy: false });
    const server = new FakeServer();
    await sync(db, server.store());
    expect(server.rows.session.get(S)).not.toHaveProperty('chosen_groups');
    await sync(db, server.store()); // pull again
    expect(await db.getFirstAsync('SELECT chosen_groups FROM session WHERE id = ?', [S])).toEqual({ chosen_groups: '["shoulders"]' });
  });
});
