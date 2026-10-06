import type { Db } from '../db';

// History (per-exercise flow, 6 oct 2026): everything from the phone's SQLite, no network.

/** A session already ended, with its logged entries (best of each exercise is picked above). */
export interface PastSession {
  id: string;
  startedAt: string | null;
  endedAt: string;
  muscleGroups: string[];
  entries: { exerciseId: string; loadKg: number; reps: number[]; createdAt: string }[];
}

/**
 * Sessions already ended with at least one logged entry, newest first. With `group`, only those that
 * worked it: chosen for the session, or an exercise of that group was logged in it.
 */
export async function getPastSessions(db: Db, group: string | null = null): Promise<PastSession[]> {
  const sessions = await db.getAllAsync<{ id: string; started_at: string | null; ended_at: string; muscle_groups: string }>(
    `SELECT s.id, s.started_at, s.ended_at, s.muscle_groups FROM session s
     WHERE s.ended_at IS NOT NULL AND s.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM entry e WHERE e.session_id = s.id AND e.status = 'ok' AND e.deleted_at IS NULL)
       AND (? IS NULL
            OR EXISTS (SELECT 1 FROM json_each(s.muscle_groups) g WHERE g.value = ?)
            OR EXISTS (SELECT 1 FROM entry e JOIN exercise x ON x.id = e.exercise_id, json_each(x.muscle_groups) g
                       WHERE e.session_id = s.id AND e.status = 'ok' AND e.deleted_at IS NULL AND g.value = ?))
     ORDER BY COALESCE(s.started_at, s.ended_at) DESC`,
    [group, group, group],
  );
  if (sessions.length === 0) return [];
  const entries = await db.getAllAsync<{ session_id: string; exercise_id: string; load_kg: number; reps: string; created_at: string }>(
    `SELECT e.session_id, e.exercise_id, e.load_kg, e.reps, e.created_at FROM entry e JOIN exercise x ON x.id = e.exercise_id
     WHERE e.session_id IN (SELECT value FROM json_each(?)) AND e.status = 'ok' AND e.deleted_at IS NULL AND x.deleted_at IS NULL
       AND e.load_kg IS NOT NULL AND e.reps IS NOT NULL
     ORDER BY e.created_at`,
    [JSON.stringify(sessions.map((s) => s.id))],
  );
  return sessions.map((s) => ({
    id: s.id,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    muscleGroups: JSON.parse(s.muscle_groups),
    entries: entries
      .filter((e) => e.session_id === s.id)
      .map((e) => ({ exerciseId: e.exercise_id, loadKg: e.load_kg, reps: JSON.parse(e.reps), createdAt: e.created_at })),
  }));
}
