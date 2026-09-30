import type { Db } from '../db';

/** A logged exercise with a known load, as stored. `createdAt` is an ISO timestamp. */
export interface LoggedSet {
  sessionId: string;
  loadKg: number;
  reps: number[];
  createdAt: string;
}

interface LoggedRow {
  session_id: string;
  load_kg: number;
  reps: string;
  created_at: string;
}

/**
 * Every resolved entry of an exercise with a known load, oldest first: the input for the engine.
 * Entries without a load (the user didn't say it) can't be compared, so they're left out.
 */
export async function getExerciseHistory(db: Db, exerciseId: string): Promise<LoggedSet[]> {
  const rows = await db.getAllAsync<LoggedRow>(
    `SELECT session_id, load_kg, reps, created_at FROM entry
     WHERE exercise_id = ? AND deleted_at IS NULL
       AND status = 'ok' AND load_kg IS NOT NULL AND reps IS NOT NULL
     ORDER BY created_at`,
    [exerciseId],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    loadKg: r.load_kg,
    reps: JSON.parse(r.reps),
    createdAt: r.created_at,
  }));
}

/**
 * Screen 2's list: for each chosen group (in order), the exercises of the last session that worked it,
 * keeping only exercises of the chosen groups, in the order they were logged. No repeats.
 */
export async function getPlanExerciseIds(db: Db, groups: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const group of groups) {
    const last = await db.getFirstAsync<{ session_id: string }>(
      `SELECT e.session_id FROM entry e JOIN exercise x ON x.id = e.exercise_id, json_each(x.muscle_groups) g
       WHERE g.value = ? AND e.status = 'ok' AND e.deleted_at IS NULL AND x.deleted_at IS NULL
       ORDER BY e.created_at DESC LIMIT 1`,
      [group],
    );
    if (!last) continue;
    const rows = await db.getAllAsync<{ exercise_id: string }>(
      `SELECT e.exercise_id, MIN(e.created_at) AS first_at
       FROM entry e JOIN exercise x ON x.id = e.exercise_id
       WHERE e.session_id = ? AND e.status = 'ok' AND e.deleted_at IS NULL AND x.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM json_each(x.muscle_groups) g WHERE g.value IN (${groups.map(() => '?').join(', ')}))
       GROUP BY e.exercise_id ORDER BY first_at`,
      [last.session_id, ...groups],
    );
    for (const r of rows) if (!ids.includes(r.exercise_id)) ids.push(r.exercise_id);
  }
  return ids;
}

/** The last logged set of every exercise that has one (for "Última: …" in the suggestions). */
export async function getLastExposures(db: Db): Promise<Map<string, LoggedSet>> {
  const rows = await db.getAllAsync<LoggedRow & { exercise_id: string }>(
    `SELECT e.exercise_id, e.session_id, e.load_kg, e.reps, e.created_at FROM entry e
     WHERE e.deleted_at IS NULL AND e.status = 'ok' AND e.load_kg IS NOT NULL AND e.reps IS NOT NULL
       AND e.created_at = (SELECT MAX(e2.created_at) FROM entry e2
                           WHERE e2.exercise_id = e.exercise_id AND e2.deleted_at IS NULL AND e2.status = 'ok'
                             AND e2.load_kg IS NOT NULL AND e2.reps IS NOT NULL)`,
    [],
  );
  return new Map(
    rows.map((r) => [
      r.exercise_id,
      { sessionId: r.session_id, loadKg: r.load_kg, reps: JSON.parse(r.reps), createdAt: r.created_at },
    ]),
  );
}
