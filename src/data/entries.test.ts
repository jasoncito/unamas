import seedJson from '../../dev/seed.json';

import type { Db } from './db';
import { initDb } from './init';
import {
  deleteUnsyncedEntry,
  getExerciseHistory,
  getSessionEntries,
  getAllPendingEntries,
  getDoubtEntry,
  insertPendingEntry,
  resolveEntry,
  setEntryRawText,
  setEntryStatus,
} from './repos/entries';
import { createSession, deleteSessionIfEmpty, getOpenSession } from './repos/sessions';
import { loadSeed, type Seed } from './seed';
import { sync } from './sync';
import { FakeServer } from './testing/fakeServer';
import { openMemoryDb } from './testing/memoryDb';

const S = 'f0000000-0000-4000-8000-0000000000a1';
const E = 'f0000000-0000-4000-8000-0000000000e1';
let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
  await createSession(db, S, ['hombro'], '2026-09-29T18:00:00.000Z');
  await insertPendingEntry(db, { id: E, sessionId: S, rawText: 'press de hombro 24 4 de 9, fácil', createdAt: '2026-09-29T18:00:00.000Z' });
});

const row = (id = E) =>
  db.getFirstAsync<{ status: string; exercise_id: string | null; load_kg: number | null; easy: number; raw_text: string; dirty: number }>(
    'SELECT status, exercise_id, load_kg, easy, raw_text, dirty FROM entry WHERE id = ?',
    [id],
  );

describe('entry lifecycle (screen 4)', () => {
  it('a pending entry has the text and nothing else yet, and is waiting to be retried', async () => {
    expect(await row()).toMatchObject({ status: 'pending', exercise_id: null, load_kg: null, raw_text: 'press de hombro 24 4 de 9, fácil' });
    expect(await getAllPendingEntries(db)).toEqual([{ id: E, rawText: 'press de hombro 24 4 de 9, fácil', sessionId: S, groups: ['hombro'] }]);
    expect(await getDoubtEntry(db, S)).toBeNull();
  });

  it('pending ones from every session come oldest first; a doubt or a deleted one is not retried', async () => {
    const S2 = 'f0000000-0000-4000-8000-0000000000a2';
    await createSession(db, S2, ['pierna'], '2026-09-28T18:00:00.000Z');
    const add = (id: string, session: string, at: string) =>
      insertPendingEntry(db, { id: `f0000000-0000-4000-8000-0000000000${id}`, sessionId: session, rawText: id, createdAt: at });
    await add('e2', S2, '2026-09-28T18:00:00.000Z');
    await add('e3', S, '2026-09-29T19:00:00.000Z');
    await add('e4', S, '2026-09-29T19:30:00.000Z');
    await add('e5', S, '2026-09-29T20:00:00.000Z');
    await setEntryStatus(db, 'f0000000-0000-4000-8000-0000000000e4', 'ambiguous');
    await db.runAsync("UPDATE entry SET deleted_at = '2026-09-29T21:00:00Z' WHERE id = ?", ['f0000000-0000-4000-8000-0000000000e5']);
    expect((await getAllPendingEntries(db)).map((e) => [e.rawText, e.groups])).toEqual([
      ['e2', ['pierna']],
      ['press de hombro 24 4 de 9, fácil', ['hombro']],
      ['e3', ['hombro']],
    ]);
  });

  it('resolving stores exercise, numbers, note and easy, ready to sync', async () => {
    const press = ids.get('press_hombro_mancuernas')!;
    await resolveEntry(db, E, { exerciseId: press, loadKg: 24, reps: [9, 9, 9, 9], rirNote: 'fácil', easy: true });
    expect(await row()).toMatchObject({ status: 'ok', exercise_id: press, load_kg: 24, easy: 1, dirty: 1 });
    expect(await getAllPendingEntries(db)).toEqual([]);
    const history = await getExerciseHistory(db, press);
    expect(history.at(-1)).toMatchObject({ loadKg: 24, reps: [9, 9, 9, 9], easy: true });
    expect(history[0].easy).toBe(false);
  });

  it('ambiguous, then their answer joins the phrase', async () => {
    await setEntryStatus(db, E, 'ambiguous');
    await setEntryRawText(db, E, 'press de hombro 24 4 de 9, fácil (con mancuernas)');
    expect(await getDoubtEntry(db, S)).toMatchObject({ id: E, rawText: 'press de hombro 24 4 de 9, fácil (con mancuernas)' });
    expect(await getAllPendingEntries(db)).toEqual([]);
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
