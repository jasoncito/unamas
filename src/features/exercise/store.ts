import { create } from 'zustand';

import { flowReducer, initialFlow, type FlowEvent, type FlowState } from './flow';

interface FlowStore {
  state: FlowState;
  dispatch(event: FlowEvent): void;
  reset(): void;
}

/** Which screen of the per-exercise flow is showing: the reducer, made reactive. The draft is in SQLite. */
export const useFlowStore = create<FlowStore>((set) => ({
  state: initialFlow,
  dispatch: (event) => set((s) => ({ state: flowReducer(s.state, event) })),
  reset: () => set({ state: initialFlow }),
}));
