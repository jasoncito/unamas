import { create } from 'zustand';

import { groupFromTyped } from './groups';

interface PickerState {
  /** Chosen muscle groups, in the order they were tapped: the order of the session. */
  selected: string[];
  /** Groups typed with "Otro…" that aren't in the data yet. */
  custom: string[];
  toggle(group: string): void;
  addCustom(group: string): void;
  reset(): void;
}

export const usePicker = create<PickerState>((set) => ({
  selected: [],
  custom: [],
  toggle: (group) =>
    set((s) => ({ selected: s.selected.includes(group) ? s.selected.filter((g) => g !== group) : [...s.selected, group] })),
  addCustom: (raw) =>
    set((s) => {
      const group = groupFromTyped(raw);
      if (!group) return s;
      return {
        custom: s.custom.includes(group) ? s.custom : [...s.custom, group],
        selected: s.selected.includes(group) ? s.selected : [...s.selected, group],
      };
    }),
  reset: () => set({ selected: [], custom: [] }),
}));
