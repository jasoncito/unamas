import type { Db } from '@/data/db';
import { getAllExercises, getExercise, type Exercise } from '@/data/repos/exercises';
import { getExerciseHistory } from '@/data/repos/entries';
import { getPastSessions } from '@/data/repos/history';
import { localDateOf } from '@/domain/dates';
import { deltaOf, type Delta } from '@/domain/delta';
import { formatDuration } from '@/domain/format';
import { bestOfEachSession } from '@/domain/history';
import { groupsLabel } from '@/domain/plan';
import type { IsoDate, LoadBasis } from '@/domain/types';
import { muscleGroupLabel } from '@/features/picker/groups';

// The visible history (6 oct 2026): past sessions, one session, one exercise over time. All from SQLite.

/** A session in a list: its date, its groups and what was done (one row per exercise, its best entry). */
export interface SessionListItem {
  sessionId: string;
  date: IsoDate;
  /** "Hombro y tríceps" */
  groupsLabel: string;
  /** "58 min", or null when it isn't known (a session without a start). */
  duration: string | null;
  rows: { exerciseId: string; name: string; loadKg: number; reps: number[]; loadBasis: LoadBasis }[];
}

/**
 * Past sessions, newest first. With `group` (the header of a section), only those that worked it, and
 * only that group's exercises in each; the whole session is one tap away.
 */
export async function loadSessionList(db: Db, group: string | null): Promise<SessionListItem[]> {
  const byId = new Map((await getAllExercises(db)).map((e) => [e.id, e]));
  return (await getPastSessions(db, group)).map((s) => {
    const rows: SessionListItem['rows'] = [];
    // Its best entry of each exercise: the same rule, with the exercise as the key (PROGRESSION.md §4).
    for (const best of bestOfEachSession(s.entries.map((e) => ({ ...e, sessionId: e.exerciseId })))) {
      const ex = byId.get(best.exerciseId);
      if (!ex || (group && !ex.muscleGroups.includes(group))) continue;
      rows.push({ exerciseId: ex.id, name: ex.canonicalName, loadKg: best.loadKg, reps: best.reps, loadBasis: ex.loadBasis });
    }
    return {
      sessionId: s.id,
      date: localDateOf(s.startedAt ?? s.endedAt),
      groupsLabel: groupsLabel(s.muscleGroups.map(muscleGroupLabel)),
      duration: s.startedAt ? formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt)) : null,
      rows,
    };
  });
}

/** One time the exercise was done, against the time before (green if it went up). */
export interface ExerciseTimelineRow {
  sessionId: string;
  date: IsoDate;
  loadKg: number;
  reps: number[];
  delta: Delta;
}

export interface ExerciseTimeline {
  exercise: Exercise;
  /** Newest first. */
  rows: ExerciseTimelineRow[];
}

/** Every session the exercise was done in (its best entry of each, PROGRESSION.md §4), newest first. */
export async function loadExerciseTimeline(db: Db, exerciseId: string): Promise<ExerciseTimeline | null> {
  const exercise = await getExercise(db, exerciseId);
  if (!exercise) return null;
  const history = bestOfEachSession(await getExerciseHistory(db, exerciseId)).map((h) => ({
    sessionId: h.sessionId,
    date: localDateOf(h.createdAt),
    loadKg: h.loadKg,
    reps: h.reps,
  }));
  const rows = history.map((h, i) => ({ ...h, delta: deltaOf(history[i - 1] ?? null, h, exercise.repFloor) }));
  return { exercise, rows: rows.reverse() };
}
