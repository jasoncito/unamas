import type { Db } from '@/data/db';
import { getAllExercises, type Exercise } from '@/data/repos/exercises';
import { muscleGroupLabel } from '@/features/picker/groups';
import {
  getDrafts,
  getExerciseHistory,
  getGroupPlans,
  getLastExposures,
  getPendingEntries,
  getSessionEntries,
  type Draft,
  type LoggedSet,
} from '@/data/repos/entries';
import { getChosenGroups, getOpenSession, getSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { deltaOf, type Delta } from '@/domain/delta';
import { nextTarget } from '@/domain/engine';
import { bestOfEachSession } from '@/domain/history';
import { formatDayLabel, formatDuration } from '@/domain/format';
import { searchExercises } from '@/domain/match';
import { groupsLabel, planRow, type PlanRow } from '@/domain/plan';
import { pickNextTime, summarize, type SummaryItem, type SummaryRow, type Tally } from '@/domain/summary';
import type { Exposure, IsoDate } from '@/domain/types';

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
  /** ISO timestamp, to place it among the pending ones. */
  createdAt: string;
}

/** Saved without signal, not understood yet: shown in "Hoy" so it isn't logged twice. */
export interface PendingLine {
  entryId: string;
  rawText: string;
  createdAt: string;
}

/** A row of a group's section: an exercise of last time, to do, started ("en curso") or done today. */
export type ListRow =
  | { kind: 'todo'; line: PlanLine }
  /** Started and not saved: tapping it goes back to screen 3. */
  | { kind: 'draft'; line: PlanLine | null; name: string; exerciseId: string; draft: Draft }
  | { kind: 'done'; line: TodayLine };

/** One chosen group on the list: "Pierna · tu última vez, 24 sep" and its rows. */
export interface GroupSection {
  group: string;
  /** "Pierna" */
  label: string;
  /** The date of the group's last time before today; null without history (no rows, only the input). */
  lastDate: IsoDate | null;
  rows: ListRow[];
}

export interface SessionScreen {
  /** Null until the first entry is saved: that's when the session row is created (CLAUDE.md §7). */
  sessionId: string | null;
  /** No entries yet: the groups header shows "‹" and going back to screen 1 is allowed. */
  canGoBack: boolean;
  /** When EMPEZAR was tapped (the session's started_at once it exists): the stopwatch counts from it. */
  startedAt: string | null;
  groups: string[];
  /** "Hombro y tríceps" */
  groupsLabel: string;
  /** One per chosen group, in the order chosen. */
  sections: GroupSection[];
  /** Logged today and not in any section (said through the input, of a group not chosen), oldest first. */
  today: TodayLine[];
  /** Waiting for /parse (no signal). */
  pending: PendingLine[];
  /** Something to end: a logged or pending entry (a draft alone isn't). */
  hasEntries: boolean;
  exercises: Exercise[];
  lastSets: Map<string, LoggedSet>;
}

/**
 * The session's list (per-exercise flow, screen 1). A session open in the database wins; otherwise the
 * groups just chosen on screen 1, which only live in memory until the first entry. Null if there's neither.
 */
export async function loadSessionScreen(
  db: Db,
  today: IsoDate,
  pendingGroups: readonly string[] | null,
  /** When EMPEZAR was tapped: the stopwatch counts from there, before any entry (backlog: gym test). */
  pendingStartedAt: string | null = null,
): Promise<SessionScreen | null> {
  const open = await getOpenSession(db);
  const groups = open?.muscleGroups ?? (pendingGroups?.length ? [...pendingGroups] : null);
  if (!groups) return null;
  // Sections are the groups chosen on screen 1; one an exercise added along the way doesn't get its own.
  const chosen = open ? ((await getChosenGroups(db, open.id)) ?? groups) : groups;

  const exercises = await getAllExercises(db);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const logged = open ? await todayLines(db, open.id, byId) : [];
  const drafts = open ? await getDrafts(db, open.id) : [];
  const placed = new Set<string>();

  const sections: GroupSection[] = [];
  for (const plan of await getGroupPlans(db, chosen, open?.id ?? null)) {
    const todo: ListRow[] = [];
    for (const id of plan.exerciseIds) {
      const ex = byId.get(id);
      if (!ex) continue;
      const line = await planLine(db, ex, today);
      const draft = drafts.find((d) => d.exerciseId === id);
      if (draft) todo.push({ kind: 'draft', line, name: ex.canonicalName, exerciseId: id, draft });
      else if (line && !logged.some((t) => t.exerciseId === id)) todo.push({ kind: 'todo', line });
    }
    // Done today goes last, not away (it might be done a second time): this section's exercises, and
    // anything else logged that works this group and isn't placed yet.
    const done = logged.filter(
      (t) => !placed.has(t.entryId) && (plan.exerciseIds.includes(t.exerciseId) || byId.get(t.exerciseId)?.muscleGroups.includes(plan.group)),
    );
    for (const t of done) placed.add(t.entryId);
    sections.push({
      group: plan.group,
      label: muscleGroupLabel(plan.group),
      lastDate: plan.lastAt ? localDateOf(plan.lastAt) : null,
      rows: [...todo, ...done.map((line) => ({ kind: 'done' as const, line }))],
    });
  }
  // A draft of an exercise that isn't in any section (a second time of one done, from "Hoy")
  // still shows, under its first group.
  for (const d of drafts) {
    if (sections.some((s) => s.rows.some((r) => r.kind === 'draft' && r.draft.id === d.id))) continue;
    const ex = byId.get(d.exerciseId);
    const section = sections.find((s) => ex?.muscleGroups.includes(s.group)) ?? sections[0];
    if (ex && section) section.rows.unshift({ kind: 'draft', line: null, name: ex.canonicalName, exerciseId: ex.id, draft: d });
  }

  const pending = open ? (await getPendingEntries(db, open.id)).map((p) => ({ entryId: p.id, rawText: p.rawText, createdAt: p.createdAt })) : [];
  return {
    sessionId: open?.id ?? null,
    canGoBack: !open,
    startedAt: open?.startedAt ?? pendingStartedAt,
    groups,
    groupsLabel: groupsLabel(groups.map(muscleGroupLabel)),
    sections,
    today: logged.filter((t) => !placed.has(t.entryId)),
    pending,
    hasEntries: logged.length + pending.length > 0,
    exercises,
    lastSets: await getLastExposures(db),
  };
}

/** Today's target for an exercise and what goes up versus its last time (design/meta.html). */
async function planLine(db: Db, ex: Exercise, today: IsoDate): Promise<PlanLine | null> {
  // One exposure per session, its best entry (PROGRESSION.md §4).
  const history = bestOfEachSession(await getExerciseHistory(db, ex.id)).map((h) => ({
    date: localDateOf(h.createdAt),
    loadKg: h.loadKg,
    reps: h.reps,
    easy: h.easy,
  }));
  const row = planRow(ex, history, today);
  return row && { ...row, name: ex.canonicalName, loadBasis: ex.loadBasis };
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
      createdAt: e.createdAt,
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
 * a number: by then they're dictating the numbers, not looking for the exercise. Exercises already done
 * today go last.
 */
export function suggestionsFor(text: string, screen: SessionScreen): Suggestion[] {
  if (/[,\d]/.test(text)) return [];
  const byId = new Map(screen.exercises.map((e) => [e.id, e]));
  const candidates = screen.exercises.map((e) => ({ id: e.id, name: e.canonicalName, aliases: e.aliases, muscleGroups: e.muscleGroups }));
  // Already done today: last, not gone (they might be logging it a second time).
  const doneToday = new Set(loggedToday(screen).map((t) => t.exerciseId));
  const found = searchExercises(text, candidates, screen.groups);
  return [...found.filter((r) => !doneToday.has(r.id)), ...found.filter((r) => doneToday.has(r.id))].map((r) => ({
    exercise: byId.get(r.id)!,
    highlight: r.highlight,
    last: screen.lastSets.get(r.id) ?? null,
  }));
}

/** Everything logged today, wherever the list shows it (in a section or under "Hoy"), oldest first. */
export function loggedToday(screen: Pick<SessionScreen, 'sections' | 'today'>): TodayLine[] {
  const inSections = screen.sections.flatMap((s) => s.rows.flatMap((r) => (r.kind === 'done' ? [r.line] : [])));
  return [...inSections, ...screen.today].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Tapping a suggestion: its name and ", ", ready for the numbers (CLAUDE.md §8, screen 3). */
export function textAfterPicking(exercise: Exercise): string {
  return `${exercise.canonicalName}, `;
}

// ─── Screens 6–7 ────────────────────────────────────────────────────────────────────────────────

export interface SessionSummary {
  /** The day it started, local. */
  date: IsoDate;
  /** "Lunes 28" */
  dayLabel: string;
  /** "Hombro y tríceps" */
  groupsLabel: string;
  /** "58 min": from the first entry to the stop. */
  duration: string;
  rows: SummaryRow[];
  tally: Tally;
  /** Saved without signal, not counted until they're understood. */
  pending: number;
  /** "La próxima vez", or null if nothing is worth singling out. */
  nextTime: ReturnType<typeof pickNextTime>;
}

/**
 * Screen 7: every exercise of the session (once, in the order first logged, with its best entry of the
 * session) against its best entry of the session before, wherever it was (PROGRESSION.md §4–5).
 */
export async function loadSummary(db: Db, sessionId: string): Promise<SessionSummary | null> {
  const session = await getSession(db, sessionId);
  if (!session) return null;
  const endedAt = session.endedAt ?? new Date().toISOString();
  const today = localDateOf(endedAt);
  const byId = new Map((await getAllExercises(db)).map((e) => [e.id, e]));

  // Each exercise once, in the order first logged.
  const exerciseIds = [...new Set((await getSessionEntries(db, sessionId)).map((e) => e.exerciseId))];

  const items: SummaryItem[] = [];
  for (const exerciseId of exerciseIds) {
    const ex = byId.get(exerciseId);
    if (!ex) continue;
    // One exposure per session, its best entry: today's and the one it's compared with (PROGRESSION.md §4–5).
    const history = bestOfEachSession(await getExerciseHistory(db, exerciseId));
    const best = history.find((h) => h.sessionId === sessionId)!;
    const previous = history.filter((h) => h.sessionId !== sessionId && h.createdAt < best.createdAt).at(-1);
    const exposure = (h: LoggedSet): Exposure => ({ date: localDateOf(h.createdAt), loadKg: h.loadKg, reps: h.reps, easy: h.easy });
    items.push({
      exerciseId,
      name: ex.canonicalName,
      loadBasis: ex.loadBasis,
      config: ex,
      previous: previous ? exposure(previous) : null,
      today: exposure(best),
      target: nextTarget(history.map(exposure), ex, today),
    });
  }

  const { rows, tally } = summarize(items);
  const date = localDateOf(session.startedAt ?? endedAt);
  return {
    date,
    dayLabel: formatDayLabel(date),
    groupsLabel: groupsLabel(session.muscleGroups.map(muscleGroupLabel)),
    duration: formatDuration(Date.parse(endedAt) - Date.parse(session.startedAt ?? endedAt)),
    rows,
    tally,
    pending: (await getPendingEntries(db, sessionId)).length,
    nextTime: pickNextTime(items),
  };
}

/** Screen 1, a doubt from a session already stopped: "De tu sesión del lunes 28 · Hombro". */
export async function loadDoubtOrigin(db: Db, entryId: string): Promise<{ dayLabel: string; groupsLabel: string } | null> {
  const row = await db.getFirstAsync<{ session_id: string }>('SELECT session_id FROM entry WHERE id = ?', [entryId]);
  const session = row && (await getSession(db, row.session_id));
  if (!session) return null;
  return {
    dayLabel: formatDayLabel(localDateOf(session.startedAt ?? session.endedAt ?? new Date().toISOString())),
    groupsLabel: groupsLabel(session.muscleGroups.map(muscleGroupLabel)),
  };
}
