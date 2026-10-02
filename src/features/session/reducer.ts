import type { SessionSummary } from './controller';
import type { FeedbackLine } from './templates';

// Session state machine (CLAUDE.md §4.3), pure: the controller runs the effects and dispatches.

export interface AmbiguityOption {
  exerciseId: string;
  label: string;
  /** "última 7.5 kg" on the button, if they have one. */
  lastLoadKg: number | null;
}

export type SessionState =
  | {
      phase: 'ready';
      text: string;
      logged: number;
      reply: string | null;
      /** Bumped each time the stop's "Mantén para terminar" should show ("listo" was said). */
      stopTip?: number;
    }
  | { phase: 'sending'; text: string; logged: number; bubble: string; image: string | null }
  | { phase: 'feedback'; text: string; logged: number; bubble: string; image: string | null; feedback: FeedbackLine }
  | {
      phase: 'disambiguating';
      text: string;
      logged: number;
      entryId: string;
      said: string;
      /** The photo sent with it, shown with the question (a machine they couldn't name). */
      image: string | null;
      question: string;
      options: AmbiguityOption[];
    }
  /** The stop completed: the screen is green with the count (2.1 s). */
  | { phase: 'ending'; text: string; logged: number; summary: SessionSummary }
  /** Screen 7. */
  | { phase: 'summary'; text: string; logged: number; summary: SessionSummary };

export type SessionEvent =
  | { type: 'TYPE'; text: string }
  | { type: 'SENT'; text: string; image?: string | null }
  | { type: 'LOGGED'; feedback: FeedbackLine; count: number }
  | { type: 'FEEDBACK_DONE' }
  | { type: 'ASK'; entryId: string; said: string; image?: string | null; question: string; options: AmbiguityOption[] }
  | { type: 'REPLY'; reply: string }
  /** "Listo" / "terminamos": show the stop's tip; it never ends the session by itself (CLAUDE.md §8). */
  | { type: 'SHOW_STOP_TIP' }
  /** "Deshacer" during "Anotado": the bubble goes and their words are back in the input. */
  | { type: 'UNDONE'; text: string; count: number }
  /** "Ahora no" on a doubt: back to ready, the entry keeps waiting. */
  | { type: 'DISMISS' }
  | { type: 'ENDED'; summary: SessionSummary }
  | { type: 'FLOOD_DONE' };

export const initialState: SessionState = { phase: 'ready', text: '', logged: 0, reply: null };

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  // Once the stop completes, a late answer (a message still on its way) changes nothing on screen.
  if (state.phase === 'ending' || state.phase === 'summary') {
    return event.type === 'FLOOD_DONE' && state.phase === 'ending' ? { ...state, phase: 'summary' } : state;
  }
  switch (event.type) {
    case 'TYPE':
      return { ...state, text: event.text };

    case 'SENT':
      // The bubble rises from the input right away, which empties (CLAUDE.md §8, screen 4).
      return { phase: 'sending', text: '', logged: state.logged, bubble: event.text, image: event.image ?? null };

    case 'LOGGED':
      if (state.phase !== 'sending') return state;
      return { ...state, phase: 'feedback', logged: state.logged + event.count, feedback: event.feedback };

    case 'FEEDBACK_DONE':
      if (state.phase !== 'feedback') return state;
      return { phase: 'ready', text: state.text, logged: state.logged, reply: null };

    case 'ASK':
      return {
        phase: 'disambiguating',
        text: '',
        logged: state.logged,
        entryId: event.entryId,
        said: event.said,
        image: event.image ?? null,
        question: event.question,
        options: event.options,
      };

    case 'REPLY':
      return { phase: 'ready', text: state.text, logged: state.logged, reply: event.reply };

    case 'SHOW_STOP_TIP':
      return {
        phase: 'ready',
        text: state.text,
        logged: state.logged,
        reply: null,
        stopTip: (state.phase === 'ready' ? (state.stopTip ?? 0) : 0) + 1,
      };

    case 'UNDONE':
      if (state.phase !== 'feedback') return state;
      return { phase: 'ready', text: event.text, logged: state.logged - event.count, reply: null };

    case 'DISMISS':
      if (state.phase !== 'disambiguating') return state;
      return { phase: 'ready', text: state.text, logged: state.logged, reply: null };

    case 'ENDED':
      return { phase: 'ending', text: '', logged: state.logged, summary: event.summary };

    case 'FLOOD_DONE':
      return state;
  }
}
