import type { Db } from '@/data/db';
import { getExercise, type Exercise } from '@/data/repos/exercises';
import { getDrafts, getExerciseHistory, insertDraftEntry, saveDraft, setDraftLoad } from '@/data/repos/entries';
import { addSessionGroups } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { nextTarget } from '@/domain/engine';
import { formatKg } from '@/domain/format';
import { bestOfEachSession } from '@/domain/history';
import { dictationOf } from '@/domain/plan';
import { parseReps, prefillReps } from '@/domain/reps';
import type { IsoDate } from '@/domain/types';
import { AiUnavailableError, type AiService } from '@/services/ai';

import type { FlowEvent, FlowState } from './flow';

/** Everything the flow's effects touch; tests pass fakes (CLAUDE.md §4.1). */
export interface FlowDeps {
  db: Db;
  ai: AiService;
  newId(): string;
  /** ISO timestamp. */
  now(): string;
  today(): IsoDate;
  /** After saving: sync a few seconds later. */
  requestSync(): void;
}

/** What the flow needs from the session it runs in. */
export interface FlowSession {
  /** The session's id, creating its row if this is its first entry (a draft counts). */
  ensureSession(): Promise<string>;
  /** Null while the session row doesn't exist yet. */
  sessionId(): string | null;
  /** A saved exercise of another group joined its groups to the session's. */
  groupsChanged(groups: string[]): void;
}

/** One exercise as screens 2–4 show it: its config, its last time and today's target from the engine. */
export interface ExerciseView {
  exercise: Exercise;
  /** Its last session's best entry (PROGRESSION.md §4), or null the first time. */
  last: { date: IsoDate; loadKg: number; reps: number[] } | null;
  suggestion: { loadKg: number; reps: number[] } | null;
}

export async function loadExerciseView(db: Db, exerciseId: string, today: IsoDate): Promise<ExerciseView | null> {
  const exercise = await getExercise(db, exerciseId);
  if (!exercise) return null;
  const history = bestOfEachSession(await getExerciseHistory(db, exerciseId)).map((h) => ({
    date: localDateOf(h.createdAt),
    loadKg: h.loadKg,
    reps: h.reps,
    easy: h.easy,
  }));
  const target = nextTarget(history, exercise, today);
  const last = history.at(-1);
  return {
    exercise,
    last: last ? { date: last.date, loadKg: last.loadKg, reps: last.reps } : null,
    suggestion: target && { loadKg: target.loadKg, reps: target.reps },
  };
}

/** What became of "O dilo como siempre". */
export type InterpretResult = 'filled' | 'unclear' | 'offline';

export interface FlowActions {
  pick(exerciseId: string): void;
  back(): void;
  /** "Empezar con X": saves the draft (or its new load) and goes to screen 3. */
  start(loadKg: number): Promise<void>;
  changeWeight(): void;
  /** "Terminé": screen 4 with the rows prefilled. */
  done(): Promise<void>;
  /** A draft left open goes back to screen 3: the latest one, or `draftId`. False if there's none. */
  resume(draftId?: string): Promise<boolean>;
  /** "O dilo como siempre": the local reader first, /parse (exercise and load fixed) if it can't. */
  interpret(text: string): Promise<InterpretResult>;
  /** "Guardar": the draft becomes a logged entry, and the list. */
  save(): Promise<void>;
}

/** The flow's effects: the draft is saved before each screen changes, so closing the app loses nothing. */
export function createFlowActions(
  deps: FlowDeps,
  session: FlowSession,
  getState: () => FlowState,
  dispatch: (e: FlowEvent) => void,
): FlowActions {
  return {
    pick: (exerciseId) => dispatch({ type: 'PICK', exerciseId }),
    back: () => dispatch({ type: 'BACK' }),
    changeWeight: () => dispatch({ type: 'CHANGE_WEIGHT' }),

    start: async (loadKg) => {
      const state = getState();
      if (state.screen !== 'weight') return;
      if (state.draft) {
        await setDraftLoad(deps.db, state.draft.id, loadKg);
        return dispatch({ type: 'STARTED', draftId: state.draft.id, loadKg });
      }
      const sessionId = await session.ensureSession();
      const id = deps.newId();
      await insertDraftEntry(deps.db, { id, sessionId, exerciseId: state.exerciseId, loadKg, createdAt: deps.now() });
      dispatch({ type: 'STARTED', draftId: id, loadKg });
    },

    done: async () => {
      const state = getState();
      if (state.screen !== 'training') return;
      const view = await loadExerciseView(deps.db, state.exerciseId, deps.today());
      if (!view) return;
      dispatch({ type: 'DONE', reps: prefillReps(view.exercise, state.loadKg, view.last) });
    },

    resume: async (draftId) => {
      const sessionId = session.sessionId();
      if (!sessionId || getState().screen !== 'list') return false;
      const drafts = await getDrafts(deps.db, sessionId);
      const draft = draftId ? drafts.find((d) => d.id === draftId) : drafts[0];
      if (!draft) return false;
      dispatch({ type: 'RESUME', exerciseId: draft.exerciseId, draftId: draft.id, loadKg: draft.loadKg });
      return true;
    },

    interpret: async (text) => {
      const local = parseReps(text);
      if (local) {
        dispatch({ type: 'FILL', reps: local });
        return 'filled';
      }
      const state = getState();
      if (state.screen !== 'reps') return 'unclear';
      const view = await loadExerciseView(deps.db, state.exerciseId, deps.today());
      if (!view) return 'unclear';
      const ex = view.exercise;
      try {
        // The exercise and the load are already fixed: /parse only has to read the sets.
        const res = await deps.ai.parse({
          text: `${ex.canonicalName}, ${formatKg(state.loadKg)} kg, ${text.trim()}`,
          image: null,
          context: {
            muscle_groups: ex.muscleGroups,
            exercises: [
              {
                id: ex.id,
                name: ex.canonicalName,
                aliases: ex.aliases.slice(0, 20),
                muscle_groups: ex.muscleGroups,
                last: view.last && { date: view.last.date, load_kg: view.last.loadKg, reps: view.last.reps },
              },
            ],
          },
        });
        const reps = res.intent === 'log' ? res.entries[0]?.reps : undefined;
        if (!reps || reps.length === 0 || getState().screen !== 'reps') return 'unclear';
        dispatch({ type: 'FILL', reps });
        return 'filled';
      } catch (e) {
        if (e instanceof AiUnavailableError) return 'offline';
        throw e;
      }
    },

    save: async () => {
      const state = getState();
      if (state.screen !== 'reps') return;
      const exercise = await getExercise(deps.db, state.exerciseId);
      const sessionId = session.sessionId();
      if (!exercise || !sessionId) return;
      await saveDraft(deps.db, state.draftId, {
        reps: state.reps,
        rawText: dictationOf(exercise.canonicalName, state.loadKg, state.reps),
        at: deps.now(),
      });
      // An exercise of another group joins its groups to the session's, as with a dictated one.
      const groups = await addSessionGroups(deps.db, sessionId, exercise.muscleGroups);
      if (groups) session.groupsChanged(groups);
      deps.requestSync();
      dispatch({ type: 'SAVED' });
    },
  };
}
