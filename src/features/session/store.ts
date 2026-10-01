import { create } from 'zustand';

import { initialState, sessionReducer, type SessionEvent, type SessionState } from './reducer';

/** How long the bubble and "Anotado" stay before going to the list (CLAUDE.md §8, §11.2: to validate). */
export const FEEDBACK_MS = 4500;

/** How long the screen stays green with the count before the summary (CLAUDE.md §8, screen 6). */
export const FLOOD_MS = 2100;

interface SessionStore {
  state: SessionState;
  dispatch(event: SessionEvent): void;
  reset(): void;
}

/** The active session's ephemeral state (CLAUDE.md §4.5): the reducer, made reactive. */
export const useSessionStore = create<SessionStore>((set) => ({
  state: initialState,
  dispatch: (event) => set((s) => ({ state: sessionReducer(s.state, event) })),
  reset: () => set({ state: initialState }),
}));
