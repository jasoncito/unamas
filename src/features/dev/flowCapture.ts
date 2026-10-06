import type { Href } from 'expo-router';

import type { Db } from '@/data/db';
import { newId, nowIso } from '@/data/ids';
import { getAllExercises } from '@/data/repos/exercises';
import { getDrafts, insertDraftEntry } from '@/data/repos/entries';
import { createSession, getOpenSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { prefillReps } from '@/domain/reps';
import { loadExerciseView } from '@/features/exercise/actions';
import { useFlowStore } from '@/features/exercise/store';

// Development only: the per-exercise flow and the history in a given state, for screenshots
// (`-devScreen flujo:lista|entrenando|reps` and `historial:musculo|sesion|ejercicio`). Works on the
// seed's history; the flow ones open a session of hombro + tríceps with one exercise done and one started.

const byName = async (db: Db, name: string) => (await getAllExercises(db)).find((e) => e.canonicalName === name)?.id ?? null;

/**
 * A session left open by an earlier capture goes, soft-deleted and dirty so that, if it reached the
 * server, the deletion does too (otherwise the next sync brings it back without its entries).
 */
async function dropOpenSessions(db: Db): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE entry SET deleted_at = ? WHERE session_id IN (SELECT id FROM session WHERE ended_at IS NULL) AND deleted_at IS NULL', [now]);
  await db.runAsync('UPDATE session SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE ended_at IS NULL AND deleted_at IS NULL', [now, now]);
}

/**
 * Hombro + tríceps: press de hombro done (+1 per set), laterales en polea started at 7.5. Fresh each
 * time, and never synced (dirty = 0): it's a screenshot, not training.
 */
async function openCaptureSession(db: Db): Promise<boolean> {
  await dropOpenSessions(db);
  const press = await byName(db, 'Press de hombro con mancuernas');
  const laterales = await byName(db, 'Laterales en polea');
  if (!press || !laterales) return false;
  const sessionId = newId();
  const now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  await createSession(db, sessionId, ['shoulders', 'triceps'], at(24));
  await db.runAsync('UPDATE session SET dirty = 0 WHERE id = ?', [sessionId]);
  await db.runAsync(
    `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, status, created_at, updated_at, dirty)
     VALUES (?, ?, ?, 24, '[9,9,9,9]', 'press de hombros, 24 kg, 4 de 9', 'ok', ?, ?, 0)`,
    [newId(), sessionId, press, at(12), at(12)],
  );
  await insertDraftEntry(db, { id: newId(), sessionId, exerciseId: laterales, loadKg: 7.5, createdAt: at(4) });
  return true;
}

/** Where to go for a capture, after preparing the database. Null if the seed isn't there. */
export async function prepareCapture(db: Db, screen: string, state: string): Promise<Href | null> {
  if (screen === 'flujo') return (await openCaptureSession(db)) ? '/session' : null;
  // The history shows ended sessions: a capture session left open by a flow screenshot goes.
  await dropOpenSessions(db);
  if (state === 'musculo') return { pathname: '/history', params: { group: 'shoulders' } };
  if (state === 'ejercicio') {
    const id = await byName(db, 'Laterales con pecho en rodillas');
    return id ? { pathname: '/history/exercise/[id]', params: { id } } : null;
  }
  const last = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM session WHERE ended_at IS NOT NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1",
    [],
  );
  return last ? { pathname: '/history/[id]', params: { id: last.id } } : null;
}

/**
 * Once the session screen reopened the draft (screen 3): `lista` goes back to the list (the draft shows
 * "en curso"), `reps` goes on to screen 4 with its rows prefilled.
 */
export async function settleFlowCapture(db: Db, state: string): Promise<void> {
  const flow = useFlowStore.getState();
  if (flow.state.screen !== 'training') return;
  if (state === 'lista') return flow.dispatch({ type: 'BACK' });
  if (state !== 'reps') return;
  const view = await loadExerciseView(db, flow.state.exerciseId, localDateOf(nowIso()));
  const open = await getOpenSession(db);
  if (!view || !open || (await getDrafts(db, open.id)).length === 0) return;
  flow.dispatch({ type: 'DONE', reps: prefillReps(view.exercise, flow.state.loadKg, view.last) });
}
