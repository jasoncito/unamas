import type { Db } from '../db';
import { nowIso } from '../ids';

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

/** A session by id (screen 7 reads the one just ended). */
export async function getSession(db: Db, id: string): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM session WHERE id = ? AND deleted_at IS NULL', [id]);
  return row && fromRow(row);
}

/** The stop completed (CLAUDE.md §7: ended_at). Dirty, so it syncs. */
export async function endSession(db: Db, id: string, endedAt: string): Promise<void> {
  await db.runAsync('UPDATE session SET ended_at = ?, updated_at = ?, dirty = 1 WHERE id = ? AND ended_at IS NULL', [endedAt, nowIso(), id]);
}

/** The session left open (the app closed before the stop), if any. */
export async function getOpenSession(db: Db): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM session WHERE ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [],
  );
  return row && fromRow(row);
}

/**
 * When each muscle group was last trained (ISO timestamp). A group counts if it was chosen for
 * a session, or if an exercise that works it was logged (sentadilla also trains glúteo).
 */
export async function getLastTrainedByGroup(db: Db): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ muscle_group: string; last_at: string }>(
    `SELECT muscle_group, MAX(at) AS last_at FROM (
       SELECT g.value AS muscle_group, s.started_at AS at
       FROM session s, json_each(s.muscle_groups) g
       WHERE s.deleted_at IS NULL AND s.started_at IS NOT NULL
       UNION ALL
       SELECT g.value, e.created_at
       FROM entry e JOIN exercise x ON x.id = e.exercise_id, json_each(x.muscle_groups) g
       WHERE e.deleted_at IS NULL AND x.deleted_at IS NULL AND e.status = 'ok'
     )
     GROUP BY muscle_group`,
    [],
  );
  return new Map(rows.map((r) => [r.muscle_group, r.last_at]));
}

/**
 * The session row, created with its first entry (CLAUDE.md §7): started_at is that entry's time.
 * Groups in the order they were chosen. Dirty, so it syncs.
 */
export async function createSession(db: Db, id: string, muscleGroups: readonly string[], startedAt: string): Promise<void> {
  await db.runAsync('INSERT INTO session (id, muscle_groups, started_at, updated_at, dirty) VALUES (?, ?, ?, ?, 1)', [
    id,
    JSON.stringify(muscleGroups),
    startedAt,
    nowIso(),
  ]);
}

/**
 * Removes a session that ended up with no entries (its only message wasn't an entry): there are no
 * empty sessions (CLAUDE.md §4.2). It never synced, since sessions upload with their first logged entry.
 */
export async function deleteSessionIfEmpty(db: Db, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM entry WHERE session_id = ?', [id]);
  if (row && row.n > 0) return false;
  await db.runAsync('DELETE FROM session WHERE id = ?', [id]);
  return true;
}

/**
 * After "Deshacer": a session left with no entries goes (there are no empty sessions). Soft delete,
 * since it may have synced with the entry that was undone. True if it went.
 */
export async function deleteSessionIfNoEntries(db: Db, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM entry WHERE session_id = ? AND deleted_at IS NULL', [id]);
  if (row && row.n > 0) return false;
  const now = nowIso();
  await db.runAsync('UPDATE session SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
  return true;
}

/** A session with no entry for this long was left open (the stop was never held). */
export const STALE_SESSION_MS = 4 * 60 * 60 * 1000;

/**
 * Closes sessions left open: no entry in the last STALE_SESSION_MS. ended_at = their last entry, so
 * the duration is the real one (decided by Claude for M8, see docs/DECISIONES.md). Returns how many.
 */
export async function endStaleSessions(db: Db, now: string, staleMs = STALE_SESSION_MS): Promise<number> {
  const cutoff = new Date(Date.parse(now) - staleMs).toISOString();
  const rows = await db.getAllAsync<{ id: string; last_at: string }>(
    `SELECT s.id, MAX(e.created_at) AS last_at FROM session s JOIN entry e ON e.session_id = s.id AND e.deleted_at IS NULL
     WHERE s.ended_at IS NULL AND s.deleted_at IS NULL
     GROUP BY s.id HAVING MAX(e.created_at) < ?`,
    [cutoff],
  );
  for (const r of rows) {
    await db.runAsync('UPDATE session SET ended_at = ?, updated_at = ?, dirty = 1 WHERE id = ? AND ended_at IS NULL', [r.last_at, nowIso(), r.id]);
  }
  return rows.length;
}

/**
 * An exercise of another group was logged (chose biceps, logged a shoulder press): its groups join the
 * session's, after the chosen ones (decided with Jason). Returns the new list, or null if nothing changed.
 */
export async function addSessionGroups(db: Db, sessionId: string, groups: readonly string[]): Promise<string[] | null> {
  const session = await getSession(db, sessionId);
  if (!session) return null;
  const missing = groups.filter((g, i) => !session.muscleGroups.includes(g) && groups.indexOf(g) === i);
  if (missing.length === 0) return null;
  const next = [...session.muscleGroups, ...missing];
  await db.runAsync('UPDATE session SET muscle_groups = ?, updated_at = ?, dirty = 1 WHERE id = ?', [JSON.stringify(next), nowIso(), sessionId]);
  return next;
}
