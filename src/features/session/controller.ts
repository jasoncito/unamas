import type { Db } from '@/data/db';
import { getAllExercises, type Exercise } from '@/data/repos/exercises';
import { getExerciseHistory, getLastExposures, getPlanExerciseIds, type LoggedSet } from '@/data/repos/entries';
import { getOpenSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { searchExercises } from '@/domain/match';
import { dictationOf, groupsLabel, planRow, type PlanRow } from '@/domain/plan';
import type { IsoDate } from '@/domain/types';

export interface PlanLine extends PlanRow {
  name: string;
  loadBasis: Exercise['loadBasis'];
}

export interface SessionScreen {
  /** Null until the first entry is saved: that's when the session row is created (CLAUDE.md §7). */
  sessionId: string | null;
  /** No entries yet: the groups header shows "‹" and going back to screen 1 is allowed. */
  canGoBack: boolean;
  groups: string[];
  /** "Hombro y tríceps" */
  groupsLabel: string;
  /** "Hoy te toca": empty when those groups have no history (then there's no list). */
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
  const plan: PlanLine[] = [];
  for (const id of await getPlanExerciseIds(db, groups)) {
    const ex = byId.get(id);
    if (!ex) continue;
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
    plan,
    placeholder: first ? dictationOf(spokenName(byId.get(first.exerciseId)!), first.loadKg, first.reps) : null,
    exercises,
    lastSets: await getLastExposures(db),
  };
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
