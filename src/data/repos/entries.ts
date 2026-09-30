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
     WHERE exercise_id = ? AND status = 'ok' AND load_kg IS NOT NULL AND reps IS NOT NULL
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
