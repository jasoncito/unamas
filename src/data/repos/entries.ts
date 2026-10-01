import type { Db } from '../db';
import { nowIso } from '../ids';

/** A logged exercise with a known load, as stored. `createdAt` is an ISO timestamp. */
export interface LoggedSet {
  sessionId: string;
  loadKg: number;
  reps: number[];
  createdAt: string;
  /** They said it was easy (3+ reps left). */
  easy: boolean;
}

interface LoggedRow {
  session_id: string;
  load_kg: number;
  reps: string;
  created_at: string;
  easy: number;
}

function fromLoggedRow(r: LoggedRow): LoggedSet {
  return { sessionId: r.session_id, loadKg: r.load_kg, reps: JSON.parse(r.reps), createdAt: r.created_at, easy: r.easy === 1 };
}

/**
 * Every resolved entry of an exercise with a known load, oldest first: the input for the engine.
 * Entries without a load (the user didn't say it) can't be compared, so they're left out.
 */
export async function getExerciseHistory(db: Db, exerciseId: string): Promise<LoggedSet[]> {
  const rows = await db.getAllAsync<LoggedRow>(
    `SELECT session_id, load_kg, reps, created_at, easy FROM entry
     WHERE exercise_id = ? AND deleted_at IS NULL
       AND status = 'ok' AND load_kg IS NOT NULL AND reps IS NOT NULL
     ORDER BY created_at`,
    [exerciseId],
  );
  return rows.map(fromLoggedRow);
}

/**
 * Screen 2's list: for each chosen group (in order), the exercises of the last session that worked it,
 * keeping only exercises of the chosen groups, in the order they were logged. No repeats.
 */
export async function getPlanExerciseIds(
  db: Db,
  groups: readonly string[],
  /** Today's session: the plan comes from the ones before it. */
  excludeSessionId: string | null = null,
): Promise<string[]> {
  const ids: string[] = [];
  for (const group of groups) {
    const last = await db.getFirstAsync<{ session_id: string }>(
      `SELECT e.session_id FROM entry e JOIN exercise x ON x.id = e.exercise_id, json_each(x.muscle_groups) g
       WHERE g.value = ? AND e.status = 'ok' AND e.deleted_at IS NULL AND x.deleted_at IS NULL
         AND e.session_id IS NOT ?
       ORDER BY e.created_at DESC LIMIT 1`,
      [group, excludeSessionId],
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
    `SELECT e.exercise_id, e.session_id, e.load_kg, e.reps, e.created_at, e.easy FROM entry e
     WHERE e.deleted_at IS NULL AND e.status = 'ok' AND e.load_kg IS NOT NULL AND e.reps IS NOT NULL
       AND e.created_at = (SELECT MAX(e2.created_at) FROM entry e2
                           WHERE e2.exercise_id = e.exercise_id AND e2.deleted_at IS NULL AND e2.status = 'ok'
                             AND e2.load_kg IS NOT NULL AND e2.reps IS NOT NULL)`,
    [],
  );
  return new Map(rows.map((r) => [r.exercise_id, fromLoggedRow(r)]));
}

// ─── Writing entries (screen 4) ─────────────────────────────────────────────────────────────────

/** What they typed or said, saved before asking /parse: the bubble shows up right away. */
export async function insertPendingEntry(
  db: Db,
  e: { id: string; sessionId: string; rawText: string; createdAt: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO entry (id, session_id, raw_text, status, created_at, updated_at, dirty)
     VALUES (?, ?, ?, 'pending', ?, ?, 1)`,
    [e.id, e.sessionId, e.rawText, e.createdAt, e.createdAt],
  );
}

/** /parse understood it: the entry gets its exercise and numbers and is ready to sync. */
export async function resolveEntry(
  db: Db,
  id: string,
  e: { exerciseId: string; loadKg: number; reps: number[]; rirNote: string | null; easy: boolean },
): Promise<void> {
  await db.runAsync(
    `UPDATE entry SET exercise_id = ?, load_kg = ?, reps = ?, rir_note = ?, easy = ?, status = 'ok', updated_at = ?, dirty = 1
     WHERE id = ?`,
    [e.exerciseId, e.loadKg, JSON.stringify(e.reps), e.rirNote, e.easy ? 1 : 0, nowIso(), id],
  );
}

export async function setEntryStatus(db: Db, id: string, status: 'pending' | 'ambiguous'): Promise<void> {
  await db.runAsync('UPDATE entry SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
}

/** Their answer to "¿Con cuánto peso?" joins the original phrase, which is parsed again. */
export async function setEntryRawText(db: Db, id: string, rawText: string): Promise<void> {
  await db.runAsync('UPDATE entry SET raw_text = ?, updated_at = ? WHERE id = ?', [rawText, nowIso(), id]);
}

/**
 * A message that wasn't an entry ("unclear", a question): it never synced (only status ok uploads),
 * so it's simply removed.
 */
export async function deleteUnsyncedEntry(db: Db, id: string): Promise<void> {
  await db.runAsync("DELETE FROM entry WHERE id = ? AND status <> 'ok'", [id]);
}

/** The session's logged entries, oldest first (screen 4's "Hoy"). */
export async function getSessionEntries(
  db: Db,
  sessionId: string,
): Promise<(LoggedSet & { id: string; exerciseId: string })[]> {
  const rows = await db.getAllAsync<LoggedRow & { id: string; exercise_id: string }>(
    `SELECT id, exercise_id, session_id, load_kg, reps, created_at, easy FROM entry
     WHERE session_id = ? AND status = 'ok' AND deleted_at IS NULL AND load_kg IS NOT NULL AND reps IS NOT NULL
     ORDER BY created_at`,
    [sessionId],
  );
  return rows.map((r) => ({ ...fromLoggedRow(r), id: r.id, exerciseId: r.exercise_id }));
}

/** The session's entries saved without signal, still waiting for /parse, oldest first. */
export async function getPendingEntries(
  db: Db,
  sessionId: string,
): Promise<{ id: string; rawText: string; createdAt: string }[]> {
  const rows = await db.getAllAsync<{ id: string; raw_text: string; created_at: string }>(
    `SELECT id, raw_text, created_at FROM entry WHERE session_id = ? AND status = 'pending' AND deleted_at IS NULL
     ORDER BY created_at`,
    [sessionId],
  );
  return rows.map((r) => ({ id: r.id, rawText: r.raw_text, createdAt: r.created_at }));
}

/** A message saved but not understood yet, with what /parse needs to try again. */
export interface UnresolvedEntry {
  id: string;
  rawText: string;
  sessionId: string;
  /** Its session's groups, to put those exercises first in the context. */
  groups: string[];
}

interface UnresolvedRow {
  id: string;
  raw_text: string;
  session_id: string;
  muscle_groups: string;
}

const fromUnresolvedRow = (r: UnresolvedRow): UnresolvedEntry => ({
  id: r.id,
  rawText: r.raw_text,
  sessionId: r.session_id,
  groups: JSON.parse(r.muscle_groups),
});

/** Every entry saved without signal, in any session, oldest first: the retry order. */
export async function getAllPendingEntries(db: Db): Promise<UnresolvedEntry[]> {
  const rows = await db.getAllAsync<UnresolvedRow>(
    `SELECT e.id, e.raw_text, e.session_id, s.muscle_groups FROM entry e JOIN session s ON s.id = e.session_id
     WHERE e.status = 'pending' AND e.deleted_at IS NULL
     ORDER BY e.created_at, e.id`,
    [],
  );
  return rows.map(fromUnresolvedRow);
}

/** The session's latest entry waiting for an answer to "which one?" or "how much?", if any. */
export async function getDoubtEntry(db: Db, sessionId: string): Promise<UnresolvedEntry | null> {
  const row = await db.getFirstAsync<UnresolvedRow>(
    `SELECT e.id, e.raw_text, e.session_id, s.muscle_groups FROM entry e JOIN session s ON s.id = e.session_id
     WHERE e.session_id = ? AND e.status = 'ambiguous' AND e.deleted_at IS NULL
     ORDER BY e.created_at DESC LIMIT 1`,
    [sessionId],
  );
  return row ? fromUnresolvedRow(row) : null;
}
