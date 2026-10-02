import type { ContextExercise, ParseResponse } from '../../../shared/contract';

import type { Db } from '@/data/db';
import { deleteExerciseIfUnused, getAllExercises, insertExercise, removeExerciseAlias, type Exercise } from '@/data/repos/exercises';
import {
  deleteEntries,
  deleteUnsyncedEntry,
  getEntryRef,
  getExerciseHistory,
  getAllPendingEntries,
  getDoubtEntry,
  getEndedSessionDoubt,
  getLastExposures,
  insertPendingEntry,
  resolveEntry,
  setEntryRawText,
  setEntryAmbiguous,
  setEntryImage,
  setEntryPending,
  type StoredAmbiguity,
  type UnresolvedEntry,
} from '@/data/repos/entries';
import { createSession, deleteSessionIfEmpty, deleteSessionIfNoEntries, endSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { deltaOf } from '@/domain/delta';
import { REP_RANGES } from '@/domain/engine';
import { normalizeName, phraseToAlias } from '@/domain/names';
import type { IsoDate, LoadBasis } from '@/domain/types';
import { AiUnavailableError, type AiService } from '@/services/ai';
import type { PhotoStore } from '@/services/image';

import { learnAliasFromChoice } from './aliases';
import { loadSummary, type SessionSummary } from './controller';
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
  /** Photos of machines, kept with their entry until it's understood. */
  photos: PhotoStore;
}

export interface SessionContext {
  /** Null until the first entry creates the session row. */
  sessionId: string | null;
  groups: readonly string[];
}

export interface SessionCopy {
  unclear: string;
  offline: string;
  /** A retried message turned out not to be an entry: "No entendí “…”. Dímelo de nuevo." */
  unclearRetry(said: string): string;
}

export interface SessionEvents {
  /** The first entry created the session: no going back to screen 1 from now on. */
  onSessionCreated(sessionId: string): void;
  /** A retry changed the lists ("Hoy", pending rows) without going through the bubble. */
  onChanged(): void;
}

/**
 * Which entries these actions look after. `open`: the session screen's (its session, still going).
 * `ended`: sessions already stopped, retried from the root; their doubts are asked on screen 1.
 */
export type SessionScope = 'open' | 'ended';

export interface SessionActions {
  /**
   * Screen 4: what they typed or dictated, with a photo of the machine if they took one (a temporary
   * file; it's kept with the entry). During a doubt, it's their answer.
   */
  send(text: string, photo?: string | null): Promise<void>;
  /** Screen 5: they tapped which exercise they meant. */
  choose(exerciseId: string): Promise<void>;
  /**
   * Asks /parse again about every entry saved without signal, oldest first and one at a time, then
   * brings back a doubt left unanswered. Quiet: it doesn't touch the bubble or what they're typing.
   * Stops at the first one still without signal. Runs on open, on foreground and when the signal returns.
   */
  retryPending(): Promise<void>;
  /** "Ahora no" on a doubt: it waits, and is asked again the next time the app opens. */
  dismissDoubt(): void;
  /** The stop completed: the session ends, and its summary. Doesn't wait for a message on its way. */
  end(): Promise<SessionSummary | null>;
  /**
   * "Deshacer" during "Anotado" (decided with Jason): the whole message goes — its entries, an exercise
   * it created (if nothing else uses it), the alias it taught, and its session if it was the first entry.
   * Their words go back to the input; returns the photo to put back with them.
   */
  undo(): Promise<{ photo: string | null } | null>;
  /**
   * "Borrar" on a row of "Hoy" (decided with Jason): that entry goes, as "Deshacer" would — with its
   * exercise if nothing else uses it, and its session if it ends up empty. A pending one (never
   * synced) is simply removed.
   */
  deleteEntry(entryId: string): Promise<void>;
}

/** What asking /parse about a saved entry ended in, with the database already updated. */
type Outcome =
  | { kind: 'offline' }
  | { kind: 'logged'; feedback: FeedbackLine; count: number; entryIds: string[]; createdExerciseIds: string[] }
  | { kind: 'ask'; question: string; options: AmbiguityOption[] }
  | { kind: 'gone'; reply: string; endSession: boolean; sessionGone: boolean };

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
  scope: SessionScope = 'open',
): SessionActions {
  let queue: Promise<void> = Promise.resolve();
  const serial = (work: () => Promise<void>) => (queue = queue.then(work, work));
  let retrying: Promise<void> | null = null;
  /** The doubt on screen and where it belongs: a closed session's, on screen 1, isn't `ctx`'s. */
  let doubt: { entryId: string; sessionId: string; groups: readonly string[]; imageUri: string | null } | null = null;
  /** Doubts put off with "Ahora no", until the app opens again. */
  const dismissed = new Set<string>();
  /** What the message on screen ("Anotado") did, so "Deshacer" can take it back. */
  let lastLogged: {
    text: string;
    imageUri: string | null;
    sessionId: string;
    entryIds: string[];
    createdExerciseIds: string[];
    learned: { exerciseId: string; alias: string } | null;
  } | null = null;
  /** The alias learned by the choice being parsed (screen 5), to undo it with the entry. */
  let learning: { exerciseId: string; alias: string } | null = null;

  const ask = (
    entryId: string,
    said: string,
    sessionId: string,
    groups: readonly string[],
    imageUri: string | null,
    out: Extract<Outcome, { kind: 'ask' }>,
  ) => {
    doubt = { entryId, sessionId, groups, imageUri };
    dispatch({ type: 'ASK', entryId, said, image: imageUri, question: out.question, options: out.options });
  };

  async function ensureSession(): Promise<{ id: string; created: boolean }> {
    if (ctx.sessionId) return { id: ctx.sessionId, created: false };
    const id = deps.newId();
    await createSession(deps.db, id, ctx.groups, deps.now());
    ctx.sessionId = id;
    return { id, created: true };
  }

  /** Asks /parse about an entry already saved and saves the answer. Dispatches nothing. */
  async function resolve(
    entryId: string,
    rawText: string,
    sessionId: string,
    groups: readonly string[],
    imageUri: string | null,
    only?: Exercise,
  ): Promise<Outcome> {
    const exercises = await getAllExercises(deps.db);
    const context = await contextFor(deps.db, only ? [only] : exercises, groups);
    const image = imageUri ? await deps.photos.base64(imageUri) : null;
    let res: ParseResponse;
    try {
      res = await deps.ai.parse({ text: rawText, image, context: { muscle_groups: [...groups], exercises: context } });
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      return { kind: 'offline' }; // kept as pending: nothing is lost
    }

    if (res.intent === 'log') {
      const saved = await saveLog(deps, entryId, rawText, sessionId, res, exercises, imageUri !== null);
      deps.requestSync();
      return { kind: 'logged', feedback: saved.feedback, count: res.entries.length, entryIds: saved.entryIds, createdExerciseIds: saved.createdExerciseIds };
    }

    if (res.intent === 'ambiguous' && res.ambiguity) {
      // Kept with the entry: shown again later (app reopened, screen 1) without asking the AI again.
      const known = new Set(exercises.map((e) => e.id));
      const stored: StoredAmbiguity = {
        question: res.ambiguity.question,
        options: res.ambiguity.options.filter((o) => known.has(o.exercise_id)).map((o) => ({ exerciseId: o.exercise_id, label: o.label })),
      };
      await setEntryAmbiguous(deps.db, entryId, stored);
      return { kind: 'ask', question: stored.question, options: await withLastLoad(stored.options) };
    }

    // Not an entry ("listo", a question, not understood): the message goes, and a session left
    // without entries goes too — there are no empty sessions.
    await deleteUnsyncedEntry(deps.db, entryId);
    const sessionGone = await deleteSessionIfEmpty(deps.db, sessionId);
    if (sessionGone && ctx.sessionId === sessionId) ctx.sessionId = null;
    return { kind: 'gone', reply: res.reply ?? copy.unclear, endSession: res.intent === 'end_session', sessionGone };
  }

  /** A message they just sent or answered: the outcome shows in the bubble. */
  async function process(
    entryId: string,
    rawText: string,
    sessionId: string,
    groups: readonly string[],
    imageUri: string | null,
    created: boolean,
    only?: Exercise,
  ) {
    const learned = learning; // only this message's
    learning = null;
    lastLogged = null;
    const out = await resolve(entryId, rawText, sessionId, groups, imageUri, only);
    if (created && !(out.kind === 'gone' && out.sessionGone)) events.onSessionCreated(sessionId);
    switch (out.kind) {
      case 'offline':
        return dispatch({ type: 'REPLY', reply: copy.offline });
      case 'logged':
        lastLogged = { text: rawText, imageUri, sessionId, entryIds: out.entryIds, createdExerciseIds: out.createdExerciseIds, learned };
        return dispatch({ type: 'LOGGED', feedback: out.feedback, count: out.count });
      case 'ask':
        return ask(entryId, rawText, sessionId, groups, imageUri, out);
      case 'gone':
        // "Listo": the stop's tip, so they hold it; it never ends the session by itself (CLAUDE.md §8).
        return dispatch(out.endSession ? { type: 'SHOW_STOP_TIP' } : { type: 'REPLY', reply: out.reply });
    }
  }

  /** Nothing on screen and nothing typed: a retried doubt can take the screen without getting in the way. */
  const idle = () => {
    const s = getState();
    return s.phase === 'ready' && s.text.trim() === '';
  };

  /** The options as buttons, each with its last load as of now (it may have changed since it was asked). */
  async function withLastLoad(options: StoredAmbiguity['options']): Promise<AmbiguityOption[]> {
    const lastSets = await getLastExposures(deps.db);
    return options.map((o) => ({ ...o, lastLoadKg: lastSets.get(o.exerciseId)?.loadKg ?? null }));
  }

  /** A doubt kept with its entry, shown again as it was asked: no AI, works without signal. Null if it can't be. */
  async function storedDoubt(entry: UnresolvedEntry): Promise<Extract<Outcome, { kind: 'ask' }> | null> {
    if (!entry.ambiguity) return null; // a doubt from before they were kept
    const alive = new Set((await getAllExercises(deps.db)).map((e) => e.id));
    const options = entry.ambiguity.options.filter((o) => alive.has(o.exerciseId));
    // "Which one?" whose exercises are all gone since: it has to be asked anew.
    if (entry.ambiguity.options.length > 0 && options.length === 0) return null;
    return { kind: 'ask', question: entry.ambiguity.question, options: await withLastLoad(options) };
  }

  /** One retried entry, quietly. False if there's still no signal. */
  async function retryOne(entry: UnresolvedEntry): Promise<boolean> {
    let out: Outcome | null = await storedDoubt(entry);
    if (!out) {
      await setEntryPending(deps.db, entry.id);
      out = await resolve(entry.id, entry.rawText, entry.sessionId, entry.groups, entry.imageUri);
    }
    if (out.kind === 'offline') {
      events.onChanged();
      return false;
    }
    if (out.kind === 'ask' && (scope === 'ended' || entry.sessionId === ctx.sessionId) && idle()) {
      ask(entry.id, entry.rawText, entry.sessionId, entry.groups, entry.imageUri, out);
    }
    // Otherwise it waits as ambiguous: it's asked again on the next retry with nothing on screen.
    if (out.kind === 'gone' && idle()) dispatch({ type: 'REPLY', reply: copy.unclearRetry(entry.rawText) });
    events.onChanged();
    return true;
  }

  /** Where the doubt on screen belongs: remembered when it was asked; the session screen's otherwise. */
  function originOf(entryId: string) {
    if (doubt?.entryId === entryId) return doubt;
    return { entryId, sessionId: ctx.sessionId!, groups: ctx.groups, imageUri: null };
  }

  return {
    send: (text, photo = null) =>
      serial(async () => {
        const said = text.trim();
        if (!said && !photo) return;
        const state = getState();
        if (scope === 'ended' && state.phase !== 'disambiguating') return; // screen 1 only answers doubts

        // During a doubt, what they type answers it: it joins the original phrase, parsed again.
        if (state.phase === 'disambiguating') {
          const origin = originOf(state.entryId);
          // A photo sent alone ("¿con cuánto peso y cuántas series?"): the answer is the whole phrase.
          const joined = !state.said ? said : state.options.length === 0 ? `${state.said}, ${said}` : `${state.said} (${said})`;
          // A new photo in the answer replaces the old one.
          const imageUri = photo ? deps.photos.keep(photo, state.entryId) : origin.imageUri;
          dispatch({ type: 'SENT', text: joined, image: imageUri });
          await setEntryRawText(deps.db, state.entryId, joined);
          if (photo) await setEntryImage(deps.db, state.entryId, imageUri);
          await setEntryPending(deps.db, state.entryId);
          return process(state.entryId, joined, origin.sessionId, origin.groups, imageUri, false);
        }

        const { id: sessionId, created } = await ensureSession();
        const entryId = deps.newId();
        const imageUri = photo ? deps.photos.keep(photo, entryId) : null;
        dispatch({ type: 'SENT', text: said, image: imageUri });
        await insertPendingEntry(deps.db, { id: entryId, sessionId, rawText: said, createdAt: deps.now(), imageUri });
        return process(entryId, said, sessionId, ctx.groups, imageUri, created);
      }),

    choose: (exerciseId) =>
      serial(async () => {
        const state = getState();
        if (state.phase !== 'disambiguating') return;
        const exercise = (await getAllExercises(deps.db)).find((e) => e.id === exerciseId);
        if (!exercise) return;
        const origin = originOf(state.entryId);
        dispatch({ type: 'SENT', text: state.said, image: origin.imageUri });
        // Their words become an alias of the chosen exercise: next time they resolve straight to it.
        // Not with a photo: "esta" points at the photo, not at the exercise.
        if (!origin.imageUri && (await learnAliasFromChoice(deps.db, state.said, exerciseId)) === 'added') {
          learning = { exerciseId, alias: phraseToAlias(state.said)! };
        }
        await setEntryPending(deps.db, state.entryId);
        // Parsed again with only that exercise, to get the numbers for it.
        return process(state.entryId, state.said, origin.sessionId, origin.groups, origin.imageUri, false, exercise);
      }),

    retryPending: () => {
      // A run already going covers this call too.
      if (retrying) return retrying;
      const tried = new Set<string>();
      const run = new Promise<void>((done) => {
        // Each entry is its own turn in the queue, so a message sent meanwhile isn't stuck behind all of them.
        const step = () =>
          serial(async () => {
            const next = (await getAllPendingEntries(deps.db, scope)).find((e) => !tried.has(e.id));
            if (next) {
              tried.add(next.id);
              if (await retryOne(next)) return void step();
              return done(); // still no signal: the rest wait for the next time
            }
            // Last, a doubt left unanswered (the app was closed on it, or it came from a retry while
            // they were busy), if nothing else is on screen.
            const left =
              scope === 'ended' ? await getEndedSessionDoubt(deps.db, [...dismissed]) : ctx.sessionId ? await getDoubtEntry(deps.db, ctx.sessionId) : null;
            if (left && !tried.has(left.id) && !dismissed.has(left.id) && idle()) {
              tried.add(left.id);
              await retryOne(left);
            }
            done();
          }).catch(() => done());
        step();
      });
      retrying = run.finally(() => (retrying = null));
      return retrying;
    },

    dismissDoubt: () => {
      const state = getState();
      if (state.phase !== 'disambiguating') return;
      dismissed.add(state.entryId);
      dispatch({ type: 'DISMISS' });
    },

    undo: async () => {
      if (getState().phase !== 'feedback' || !lastLogged) return null;
      const u = lastLogged;
      lastLogged = null;
      // The screen first: their words back in the input, the bubble gone.
      dispatch({ type: 'UNDONE', text: u.text, count: u.entryIds.length });
      await deleteEntries(deps.db, u.entryIds);
      for (const id of u.createdExerciseIds) await deleteExerciseIfUnused(deps.db, id);
      if (u.learned) await removeExerciseAlias(deps.db, u.learned.exerciseId, u.learned.alias);
      if ((await deleteSessionIfNoEntries(deps.db, u.sessionId)) && ctx.sessionId === u.sessionId) ctx.sessionId = null;
      deps.requestSync();
      events.onChanged();
      return { photo: u.imageUri };
    },

    deleteEntry: (entryId) =>
      serial(async () => {
        const ref = await getEntryRef(deps.db, entryId);
        if (!ref) return;
        if (ref.status === 'ok') await deleteEntries(deps.db, [entryId]);
        else await deleteUnsyncedEntry(deps.db, entryId);
        if (ref.exerciseId) await deleteExerciseIfUnused(deps.db, ref.exerciseId);
        if ((await deleteSessionIfNoEntries(deps.db, ref.sessionId)) && ctx.sessionId === ref.sessionId) ctx.sessionId = null;
        deps.requestSync();
        events.onChanged();
      }),

    end: async () => {
      if (!ctx.sessionId) return null;
      await endSession(deps.db, ctx.sessionId, deps.now());
      deps.requestSync();
      const summary = await loadSummary(deps.db, ctx.sessionId);
      if (summary) dispatch({ type: 'ENDED', summary });
      return summary;
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
  /** Sent with a photo: their words ("esta, 25 a cada lado") point at it, so they're no alias. */
  withPhoto: boolean,
) {
  let first: ReturnType<typeof feedbackLine> | null = null;
  const entryIds: string[] = [];
  const createdExerciseIds: string[] = [];
  for (const [i, e] of res.entries.entries()) {
    let exercise = e.exercise_id ? exercises.find((x) => x.id === e.exercise_id) : undefined;
    if (!exercise && e.new_exercise) {
      const n = e.new_exercise;
      const [repFloor, repTop] = REP_RANGES[n.kind];
      const alias = withPhoto ? '' : phraseToAlias(rawText);
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
      createdExerciseIds.push(exercise.id);
    }
    if (!exercise) continue;

    const history = await getExerciseHistory(deps.db, exercise.id);
    const previous = history.at(-1) ?? null;
    const id = i === 0 ? entryId : deps.newId();
    if (i > 0) await insertPendingEntry(deps.db, { id, sessionId, rawText, createdAt: deps.now() });
    entryIds.push(id);
    await resolveEntry(deps.db, id, {
      exerciseId: exercise.id,
      loadKg: e.load_kg!,
      reps: e.reps,
      rirNote: e.rir_note,
      easy: e.easy,
    });

    const today = { date: deps.today(), loadKg: e.load_kg!, reps: e.reps };
    const prev = previous && { date: localDateOf(previous.createdAt), loadKg: previous.loadKg, reps: previous.reps };
    first ??= feedbackLine(deltaOf(prev, today, exercise.repFloor), prev?.date ?? null, deps.today(), exercise.canonicalName);
  }
  return { feedback: first ?? feedbackLine({ kind: 'new' }, null, deps.today(), ''), entryIds, createdExerciseIds };
}

