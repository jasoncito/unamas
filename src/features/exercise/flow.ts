import { MAX_REPS, MIN_REPS } from '@/domain/reps';

// The per-exercise flow (6 oct 2026), pure: list → weight → training → reps → list. The effects (the
// draft in SQLite, the AI for reps it can't read) live in actions.ts, which dispatches these events.

export type FlowState =
  /** Screen 1: the sections with last time's exercises, and the input for anything else. */
  | { screen: 'list' }
  /** Screen 2: the weight selector. `draft` = changing the load of one already started ("cambiar peso"). */
  | { screen: 'weight'; exerciseId: string; draft: { id: string; loadKg: number } | null }
  /** Screen 3: the load, the range to aim for, last time. The draft is saved. */
  | { screen: 'training'; exerciseId: string; draftId: string; loadKg: number }
  /** Screen 4: one row per set. */
  | { screen: 'reps'; exerciseId: string; draftId: string; loadKg: number; reps: number[] };

export type FlowEvent =
  /** A row of the list: choose its weight. */
  | { type: 'PICK'; exerciseId: string }
  /** "Empezar con X": the draft is saved with that load (a new one, or the one whose load changed). */
  | { type: 'STARTED'; draftId: string; loadKg: number }
  /** "cambiar peso": back to the selector, starting at the current load. */
  | { type: 'CHANGE_WEIGHT' }
  /** "Terminé": the rows, prefilled. */
  | { type: 'DONE'; reps: number[] }
  /** A draft left open: the app reopened on it, or its "en curso" row was tapped. */
  | { type: 'RESUME'; exerciseId: string; draftId: string; loadKg: number }
  | { type: 'SET_REP'; index: number; reps: number }
  | { type: 'ADD_SET' }
  | { type: 'REMOVE_SET'; index: number }
  /** "O dilo como siempre": what they said, understood, replaces the rows. */
  | { type: 'FILL'; reps: number[] }
  /** "‹": one screen back. From training the draft stays, and its row says "en curso". */
  | { type: 'BACK' }
  /** "Guardar": logged; back to the list. */
  | { type: 'SAVED' }
  /** The draft went (the session ended): back to the list. */
  | { type: 'CLOSED' };

export const initialFlow: FlowState = { screen: 'list' };

const clampReps = (n: number) => Math.max(MIN_REPS, Math.min(MAX_REPS, Math.round(n)));
/** More sets than anyone does; a guard against tapping "+ Agregar serie" forever. */
export const MAX_SETS = 20;

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'PICK':
      return state.screen === 'list' ? { screen: 'weight', exerciseId: event.exerciseId, draft: null } : state;

    case 'STARTED':
      return state.screen === 'weight'
        ? { screen: 'training', exerciseId: state.exerciseId, draftId: event.draftId, loadKg: event.loadKg }
        : state;

    case 'CHANGE_WEIGHT':
      return state.screen === 'training'
        ? { screen: 'weight', exerciseId: state.exerciseId, draft: { id: state.draftId, loadKg: state.loadKg } }
        : state;

    case 'DONE':
      return state.screen === 'training' ? { ...state, screen: 'reps', reps: event.reps.map(clampReps) } : state;

    case 'RESUME':
      return state.screen === 'list'
        ? { screen: 'training', exerciseId: event.exerciseId, draftId: event.draftId, loadKg: event.loadKg }
        : state;

    case 'SET_REP':
      if (state.screen !== 'reps' || event.index < 0 || event.index >= state.reps.length) return state;
      return { ...state, reps: state.reps.map((r, i) => (i === event.index ? clampReps(event.reps) : r)) };

    case 'ADD_SET':
      // A new set starts like the last one: the usual case is "one more of the same".
      if (state.screen !== 'reps' || state.reps.length >= MAX_SETS) return state;
      return { ...state, reps: [...state.reps, state.reps.at(-1) ?? MIN_REPS] };

    case 'REMOVE_SET':
      // At least one set stays: zero sets isn't an entry.
      if (state.screen !== 'reps' || state.reps.length <= 1) return state;
      return { ...state, reps: state.reps.filter((_, i) => i !== event.index) };

    case 'FILL':
      if (state.screen !== 'reps' || event.reps.length === 0) return state;
      return { ...state, reps: event.reps.slice(0, MAX_SETS).map(clampReps) };

    case 'BACK':
      switch (state.screen) {
        case 'list':
          return state;
        case 'weight':
          // Changing the load of a started draft: back to it, as it was.
          return state.draft
            ? { screen: 'training', exerciseId: state.exerciseId, draftId: state.draft.id, loadKg: state.draft.loadKg }
            : initialFlow;
        case 'training':
          return initialFlow;
        case 'reps':
          return { screen: 'training', exerciseId: state.exerciseId, draftId: state.draftId, loadKg: state.loadKg };
      }
      return state;

    case 'SAVED':
      return state.screen === 'reps' ? initialFlow : state;

    case 'CLOSED':
      return initialFlow;
  }
}
