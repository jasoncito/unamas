import type { FeedbackLine } from './templates';

// Screen 4–5 state machine (CLAUDE.md §4.3), pure: the controller runs the effects and dispatches.
// M6 adds ending → summary.

export interface AmbiguityOption {
  exerciseId: string;
  label: string;
  /** "última 7.5 kg" on the button, if they have one. */
  lastLoadKg: number | null;
}

export type SessionState =
  | { phase: 'ready'; text: string; logged: number; reply: string | null }
  | { phase: 'sending'; text: string; logged: number; bubble: string }
  | { phase: 'feedback'; text: string; logged: number; bubble: string; feedback: FeedbackLine }
  | {
      phase: 'disambiguating';
      text: string;
      logged: number;
      entryId: string;
      said: string;
      question: string;
      options: AmbiguityOption[];
    };

export type SessionEvent =
  | { type: 'TYPE'; text: string }
  | { type: 'SENT'; text: string }
  | { type: 'LOGGED'; feedback: FeedbackLine; count: number }
  | { type: 'FEEDBACK_DONE' }
  | { type: 'ASK'; entryId: string; said: string; question: string; options: AmbiguityOption[] }
  | { type: 'REPLY'; reply: string };

export const initialState: SessionState = { phase: 'ready', text: '', logged: 0, reply: null };

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'TYPE':
      return { ...state, text: event.text };

    case 'SENT':
      // The bubble rises from the input right away, which empties (CLAUDE.md §8, screen 4).
      return { phase: 'sending', text: '', logged: state.logged, bubble: event.text };

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
        question: event.question,
        options: event.options,
      };

    case 'REPLY':
      return { phase: 'ready', text: state.text, logged: state.logged, reply: event.reply };
  }
}
