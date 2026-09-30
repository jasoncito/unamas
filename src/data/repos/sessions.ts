import type { Db } from '../db';

export interface Session {
  id: string;
  muscleGroups: string[];
  startedAt: string | null;
  endedAt: string | null;
  avgBpm: number | null;
}

interface SessionRow {
  id: string;
  muscle_groups: string;
  started_at: string | null;
  ended_at: string | null;
  avg_bpm: number | null;
}

function fromRow(r: SessionRow): Session {
  return {
    id: r.id,
    muscleGroups: JSON.parse(r.muscle_groups),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    avgBpm: r.avg_bpm,
  };
}

/** The session left open (the app closed before the stop), if any. */
export async function getOpenSession(db: Db, userId: string): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM session WHERE user_id = ? AND ended_at IS NULL AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
  return row && fromRow(row);
}

/**
 * When each muscle group was last trained (ISO timestamp). A group counts if it was chosen for
 * a session, or if an exercise that works it was logged (sentadilla also trains glúteo).
 */
export async function getLastTrainedByGroup(db: Db, userId: string): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ muscle_group: string; last_at: string }>(
    `SELECT muscle_group, MAX(at) AS last_at FROM (
       SELECT g.value AS muscle_group, s.started_at AS at
       FROM session s, json_each(s.muscle_groups) g
       WHERE s.user_id = ? AND s.deleted_at IS NULL AND s.started_at IS NOT NULL
       UNION ALL
       SELECT g.value, e.created_at
       FROM entry e JOIN exercise x ON x.id = e.exercise_id, json_each(x.muscle_groups) g
       WHERE e.user_id = ? AND e.deleted_at IS NULL AND x.deleted_at IS NULL AND e.status = 'ok'
     )
     GROUP BY muscle_group`,
    [userId, userId],
  );
  return new Map(rows.map((r) => [r.muscle_group, r.last_at]));
}
