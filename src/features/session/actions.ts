import type { ContextExercise, ParseResponse } from '../../../shared/contract';

import type { Db } from '@/data/db';
import { getAllExercises, insertExercise, type Exercise } from '@/data/repos/exercises';
import {
  deleteUnsyncedEntry,
  getExerciseHistory,
  getAllPendingEntries,
  getDoubtEntry,
  getLastExposures,
  insertPendingEntry,
  resolveEntry,
  setEntryRawText,
  setEntryStatus,
  type UnresolvedEntry,
} from '@/data/repos/entries';
import { createSession, deleteSessionIfEmpty } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { deltaOf } from '@/domain/delta';
import { REP_RANGES } from '@/domain/engine';
import { normalizeName, phraseToAlias } from '@/domain/names';
import type { IsoDate, LoadBasis } from '@/domain/types';
import { AiUnavailableError, type AiService } from '@/services/ai';

import { learnAliasFromChoice } from './aliases';
import type { AmbiguityOption, SessionEvent, SessionState } from './reducer';
import { feedbackLine, type FeedbackLine } from './templates';

/** Everything the session's effects touch; tests pass fakes (CLAUDE.md §4.1). */
export interface SessionDeps {
  db: Db;
  ai: AiService;
  newId(): string;
  /** ISO timestamp. */
  now(): string;
  today(): IsoDate;
  /** After saving: sync a few seconds later. */
  requestSync(): void;
}

export interface SessionContext {
  /** Null until the first entry creates the session row. */
  sessionId: string | null;
  groups: readonly string[];
}

export interface SessionCopy {
  unclear: string;
  offline: string;
  stopTip: string;
  /** A retried message turned out not to be an entry: "No entendí “…”. Dímelo de nuevo." */
  unclearRetry(said: string): string;
}

export interface SessionEvents {
  /** The first entry created the session: no going back to screen 1 from now on. */
  onSessionCreated(sessionId: string): void;
  /** A retry changed the lists ("Hoy", pending rows) without going through the bubble. */
  onChanged(): void;
}

export interface SessionActions {
  /** Screen 4: what they typed or dictated. During a doubt, it's their answer. */
  send(text: string): Promise<void>;
  /** Screen 5: they tapped which exercise they meant. */
  choose(exerciseId: string): Promise<void>;
  /**
   * Asks /parse again about every entry saved without signal, oldest first and one at a time, then
   * brings back a doubt left unanswered. Quiet: it doesn't touch the bubble or what they're typing.
   * Stops at the first one still without signal. Runs on open, on foreground and when the signal returns.
   */
  retryPending(): Promise<void>;
}

/** What asking /parse about a saved entry ended in, with the database already updated. */
type Outcome =
  | { kind: 'offline' }
  | { kind: 'logged'; feedback: FeedbackLine; count: number }
  | { kind: 'ask'; question: string; options: AmbiguityOption[] }
  | { kind: 'gone'; reply: string; sessionGone: boolean };

/**
 * The session's effects (CLAUDE.md §4.4): save first, then ask /parse, then save what it understood.
 * Messages run one after another; one sent while another is still on its way waits its turn.
 */
export function createSessionActions(
  deps: SessionDeps,
  ctx: SessionContext,
  getState: () => SessionState,
  dispatch: (e: SessionEvent) => void,
  copy: SessionCopy,
  events: SessionEvents,
): SessionActions {
  let queue: Promise<void> = Promise.resolve();
  const serial = (work: () => Promise<void>) => (queue = queue.then(work, work));
  let retrying: Promise<void> | null = null;

  async function ensureSession(): Promise<{ id: string; created: boolean }> {
    if (ctx.sessionId) return { id: ctx.sessionId, created: false };
    const id = deps.newId();
    await createSession(deps.db, id, ctx.groups, deps.now());
    ctx.sessionId = id;
    return { id, created: true };
  }

  /** Asks /parse about an entry already saved and saves the answer. Dispatches nothing. */
  async function resolve(entryId: string, rawText: string, sessionId: string, groups: readonly string[], only?: Exercise): Promise<Outcome> {
    const exercises = await getAllExercises(deps.db);
    const context = await contextFor(deps.db, only ? [only] : exercises, groups);
    let res: ParseResponse;
    try {
      res = await deps.ai.parse({ text: rawText, image: null, context: { muscle_groups: [...groups], exercises: context } });
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      return { kind: 'offline' }; // kept as pending: nothing is lost
    }

    if (res.intent === 'log') {
      const feedback = await saveLog(deps, entryId, rawText, sessionId, res, exercises);
      deps.requestSync();
      return { kind: 'logged', feedback, count: res.entries.length };
    }

    if (res.intent === 'ambiguous' && res.ambiguity) {
      await setEntryStatus(deps.db, entryId, 'ambiguous');
      const lastSets = await getLastExposures(deps.db);
      const byId = new Map(exercises.map((e) => [e.id, e]));
      const options: AmbiguityOption[] = res.ambiguity.options
        .filter((o) => byId.has(o.exercise_id))
        .map((o) => ({ exerciseId: o.exercise_id, label: o.label, lastLoadKg: lastSets.get(o.exercise_id)?.loadKg ?? null }));
      return { kind: 'ask', question: res.ambiguity.question, options };
    }

    // Not an entry ("listo", a question, not understood): the message goes, and a session left
    // without entries goes too — there are no empty sessions.
    await deleteUnsyncedEntry(deps.db, entryId);
    const sessionGone = await deleteSessionIfEmpty(deps.db, sessionId);
    if (sessionGone && ctx.sessionId === sessionId) ctx.sessionId = null;
    return { kind: 'gone', reply: res.intent === 'end_session' ? copy.stopTip : (res.reply ?? copy.unclear), sessionGone };
  }

  /** A message they just sent or answered: the outcome shows in the bubble. */
  async function process(entryId: string, rawText: string, sessionId: string, created: boolean, only?: Exercise) {
    const out = await resolve(entryId, rawText, sessionId, ctx.groups, only);
    if (created && !(out.kind === 'gone' && out.sessionGone)) events.onSessionCreated(sessionId);
    switch (out.kind) {
      case 'offline':
        return dispatch({ type: 'REPLY', reply: copy.offline });
      case 'logged':
        return dispatch({ type: 'LOGGED', feedback: out.feedback, count: out.count });
      case 'ask':
        return dispatch({ type: 'ASK', entryId, said: rawText, question: out.question, options: out.options });
      case 'gone':
        return dispatch({ type: 'REPLY', reply: out.reply });
    }
  }

  /** Nothing on screen and nothing typed: a retried doubt can take the screen without getting in the way. */
  const idle = () => {
    const s = getState();
    return s.phase === 'ready' && s.text.trim() === '';
  };

  /** One retried entry, quietly. False if there's still no signal. */
  async function retryOne(entry: UnresolvedEntry): Promise<boolean> {
    await setEntryStatus(deps.db, entry.id, 'pending');
    const out = await resolve(entry.id, entry.rawText, entry.sessionId, entry.groups);
    if (out.kind === 'offline') {
      events.onChanged();
      return false;
    }
    if (out.kind === 'ask' && entry.sessionId === ctx.sessionId && idle()) {
      dispatch({ type: 'ASK', entryId: entry.id, said: entry.rawText, question: out.question, options: out.options });
    }
    // Otherwise it waits as ambiguous: it's asked again on the next retry with nothing on screen.
    if (out.kind === 'gone' && idle()) dispatch({ type: 'REPLY', reply: copy.unclearRetry(entry.rawText) });
    events.onChanged();
    return true;
  }

  return {
    send: (text) =>
      serial(async () => {
        const said = text.trim();
        if (!said) return;
        const state = getState();
        dispatch({ type: 'SENT', text: said });

        // During a doubt, what they type answers it: it joins the original phrase, parsed again.
        if (state.phase === 'disambiguating') {
          const joined = state.options.length === 0 ? `${state.said}, ${said}` : `${state.said} (${said})`;
          await setEntryRawText(deps.db, state.entryId, joined);
          await setEntryStatus(deps.db, state.entryId, 'pending');
          return process(state.entryId, joined, ctx.sessionId!, false);
        }

        const { id: sessionId, created } = await ensureSession();
        const entryId = deps.newId();
        await insertPendingEntry(deps.db, { id: entryId, sessionId, rawText: said, createdAt: deps.now() });
        return process(entryId, said, sessionId, created);
      }),

    choose: (exerciseId) =>
      serial(async () => {
        const state = getState();
        if (state.phase !== 'disambiguating') return;
        const exercise = (await getAllExercises(deps.db)).find((e) => e.id === exerciseId);
        if (!exercise) return;
        dispatch({ type: 'SENT', text: state.said });
        // Their words become an alias of the chosen exercise: next time they resolve straight to it.
        await learnAliasFromChoice(deps.db, state.said, exerciseId);
        await setEntryStatus(deps.db, state.entryId, 'pending');
        // Parsed again with only that exercise, to get the numbers for it.
        return process(state.entryId, state.said, ctx.sessionId!, false, exercise);
      }),

    retryPending: () => {
      // A run already going covers this call too.
      if (retrying) return retrying;
      const tried = new Set<string>();
      const run = new Promise<void>((done) => {
        // Each entry is its own turn in the queue, so a message sent meanwhile isn't stuck behind all of them.
        const step = () =>
          serial(async () => {
            const next = (await getAllPendingEntries(deps.db)).find((e) => !tried.has(e.id));
            if (next) {
              tried.add(next.id);
              if (await retryOne(next)) return void step();
              return done(); // still no signal: the rest wait for the next time
            }
            // Last, a doubt left unanswered (the app was closed on it), if nothing else is on screen.
            const doubt = ctx.sessionId ? await getDoubtEntry(deps.db, ctx.sessionId) : null;
            if (doubt && !tried.has(doubt.id) && idle()) {
              tried.add(doubt.id);
              await retryOne(doubt);
            }
            done();
          }).catch(() => done());
        step();
      });
      retrying = run.finally(() => (retrying = null));
      return retrying;
    },
  };
}

/** Their exercises for /parse, the session's groups first (CLAUDE.md §4.4, step 2). */
async function contextFor(db: Db, exercises: readonly Exercise[], groups: readonly string[]): Promise<ContextExercise[]> {
  const lastSets = await getLastExposures(db);
  const inGroups = (e: Exercise) => e.muscleGroups.some((g) => groups.includes(g));
  return [...exercises]
    .sort((a, b) => Number(inGroups(b)) - Number(inGroups(a)))
    .slice(0, 300)
    .map((e) => {
      const last = lastSets.get(e.id);
      return {
        id: e.id,
        name: e.canonicalName,
        aliases: e.aliases.slice(0, 20),
        muscle_groups: e.muscleGroups,
        last: last ? { date: localDateOf(last.createdAt), load_kg: last.loadKg, reps: last.reps } : null,
      };
    });
}

/** Default step per equipment until the user's own jumps teach another (PROGRESSION.md §3.2). */
const DEFAULT_STEP: Record<LoadBasis, number> = { per_dumbbell: 2, per_side: 2.5, stack: 2.5, total: 2.5 };

/** Saves every exercise /parse understood; the first one completes the pending entry. */
async function saveLog(
  deps: SessionDeps,
  entryId: string,
  rawText: string,
  sessionId: string,
  res: ParseResponse,
  exercises: readonly Exercise[],
) {
  let first: ReturnType<typeof feedbackLine> | null = null;
  for (const [i, e] of res.entries.entries()) {
    let exercise = e.exercise_id ? exercises.find((x) => x.id === e.exercise_id) : undefined;
    if (!exercise && e.new_exercise) {
      const n = e.new_exercise;
      const [repFloor, repTop] = REP_RANGES[n.kind];
      const alias = phraseToAlias(rawText);
      exercise = {
        id: deps.newId(),
        canonicalName: n.canonical_name,
        // The detail stays in the aliases: their own words, without numbers (CLAUDE.md §7).
        aliases: alias && normalizeName(alias) !== normalizeName(n.canonical_name) ? [alias] : [],
        muscleGroups: n.muscle_groups,
        kind: n.kind,
        repFloor,
        repTop,
        stepKg: DEFAULT_STEP[n.load_basis],
        loadBasis: n.load_basis,
        createdAt: deps.now(),
      };
      await insertExercise(deps.db, exercise);
    }
    if (!exercise) continue;

    const history = await getExerciseHistory(deps.db, exercise.id);
    const previous = history.at(-1) ?? null;
    const id = i === 0 ? entryId : deps.newId();
    if (i > 0) await insertPendingEntry(deps.db, { id, sessionId, rawText, createdAt: deps.now() });
    await resolveEntry(deps.db, id, {
      exerciseId: exercise.id,
      loadKg: e.load_kg!,
      reps: e.reps,
      rirNote: e.rir_note,
      easy: e.easy,
    });

    const today = { date: deps.today(), loadKg: e.load_kg!, reps: e.reps };
    const prev = previous && { date: localDateOf(previous.createdAt), loadKg: previous.loadKg, reps: previous.reps };
    first ??= feedbackLine(deltaOf(prev, today, exercise.repFloor), prev?.date ?? null, deps.today());
  }
  return first ?? feedbackLine({ kind: 'new' }, null, deps.today());
}

