import type { Db } from '@/data/db';
import { getAllExercises, type Exercise } from '@/data/repos/exercises';
import { getExerciseHistory, getLastExposures, getPlanExerciseIds, getSessionEntries, type LoggedSet } from '@/data/repos/entries';
import { getOpenSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { deltaOf, type Delta } from '@/domain/delta';
import { searchExercises } from '@/domain/match';
import { dictationOf, groupsLabel, planRow, type PlanRow } from '@/domain/plan';
import type { IsoDate } from '@/domain/types';

export interface PlanLine extends PlanRow {
  name: string;
  loadBasis: Exercise['loadBasis'];
}

/** A row of "Hoy": what they logged, against that exercise's own previous entry (CLAUDE.md §8). */
export interface TodayLine {
  entryId: string;
  exerciseId: string;
  name: string;
  loadBasis: Exercise['loadBasis'];
  loadKg: number;
  reps: number[];
  /** The date it's compared with, or null the first time. */
  comparedTo: IsoDate | null;
  delta: Delta;
}

export interface SessionScreen {
  /** Null until the first entry is saved: that's when the session row is created (CLAUDE.md §7). */
  sessionId: string | null;
  /** No entries yet: the groups header shows "‹" and going back to screen 1 is allowed. */
  canGoBack: boolean;
  groups: string[];
  /** "Hombro y tríceps" */
  groupsLabel: string;
  /** What's logged so far, oldest first. */
  today: TodayLine[];
  /** "Hoy te toca": what's left of the last time. Empty when those groups have no history. */
  plan: PlanLine[];
  /** The first plan line as it would be dictated, or null to use the generic placeholder. */
  placeholder: string | null;
  exercises: Exercise[];
  lastSets: Map<string, LoggedSet>;
}

/**
 * Screens 2–3 data. A session open in the database (it has entries) wins; otherwise the groups just
 * chosen on screen 1, which only live in memory until the first entry. Null if there's neither.
 */
export async function loadSessionScreen(
  db: Db,
  today: IsoDate,
  pendingGroups: readonly string[] | null,
): Promise<SessionScreen | null> {
  const open = await getOpenSession(db);
  const groups = open?.muscleGroups ?? (pendingGroups?.length ? [...pendingGroups] : null);
  if (!groups) return null;

  const exercises = await getAllExercises(db);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const logged = open ? await todayLines(db, open.id, byId) : [];
  const done = new Set(logged.map((t) => t.exerciseId));
  const plan: PlanLine[] = [];
  for (const id of await getPlanExerciseIds(db, groups, open?.id ?? null)) {
    const ex = byId.get(id);
    if (!ex || done.has(id)) continue;
    const history = (await getExerciseHistory(db, id)).map((h) => ({
      date: localDateOf(h.createdAt),
      loadKg: h.loadKg,
      reps: h.reps,
    }));
    const row = planRow(ex, history, today);
    if (row) plan.push({ ...row, name: ex.canonicalName, loadBasis: ex.loadBasis });
  }

  const first = plan[0];
  return {
    sessionId: open?.id ?? null,
    canGoBack: !open,
    groups,
    groupsLabel: groupsLabel(groups),
    today: logged,
    plan,
    placeholder: first ? dictationOf(spokenName(byId.get(first.exerciseId)!), first.loadKg, first.reps) : null,
    exercises,
    lastSets: await getLastExposures(db),
  };
}

async function todayLines(db: Db, sessionId: string, byId: Map<string, Exercise>): Promise<TodayLine[]> {
  const lines: TodayLine[] = [];
  for (const e of await getSessionEntries(db, sessionId)) {
    const ex = byId.get(e.exerciseId);
    if (!ex) continue;
    const history = await getExerciseHistory(db, e.exerciseId);
    const previous = history.filter((h) => h.createdAt < e.createdAt).at(-1);
    const prev = previous ? { date: localDateOf(previous.createdAt), loadKg: previous.loadKg, reps: previous.reps } : null;
    lines.push({
      entryId: e.id,
      exerciseId: e.exerciseId,
      name: ex.canonicalName,
      loadBasis: ex.loadBasis,
      loadKg: e.loadKg,
      reps: e.reps,
      comparedTo: prev?.date ?? null,
      delta: deltaOf(prev, { date: localDateOf(e.createdAt), loadKg: e.loadKg, reps: e.reps }, ex.repFloor),
    });
  }
  return lines;
}

export interface Suggestion {
  exercise: Exercise;
  /** Part of the name to show in bold, [start, end). */
  highlight: [number, number] | null;
  last: LoggedSet | null;
}

/**
 * Screen 3: local suggestions for what's typed (no AI per keystroke). None once the text has a comma or
 * a number: by then they're dictating the numbers, not looking for the exercise.
 */
export function suggestionsFor(text: string, screen: SessionScreen): Suggestion[] {
  if (/[,\d]/.test(text)) return [];
  const byId = new Map(screen.exercises.map((e) => [e.id, e]));
  const candidates = screen.exercises.map((e) => ({ id: e.id, name: e.canonicalName, aliases: e.aliases, muscleGroups: e.muscleGroups }));
  return searchExercises(text, candidates, screen.groups).map((r) => ({
    exercise: byId.get(r.id)!,
    highlight: r.highlight,
    last: screen.lastSets.get(r.id) ?? null,
  }));
}

/** Tapping a suggestion: its name and ", ", ready for the numbers (CLAUDE.md §8, screen 3). */
export function textAfterPicking(exercise: Exercise): string {
  return `${exercise.canonicalName}, `;
}

/** How the person calls the exercise: its first alias (their own words), or the name in lowercase. */
function spokenName(exercise: Exercise): string {
  return exercise.aliases[0] ?? exercise.canonicalName.toLowerCase();
}
