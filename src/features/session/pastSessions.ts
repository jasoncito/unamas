import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { newId, nowIso } from '@/data/ids';
import { localDateOf } from '@/domain/dates';
import { requestSync } from '@/features/sync/useSync';
import { getPhotosInUse } from '@/data/repos/entries';
import { ai } from '@/services/aiClient';
import { photos } from '@/services/image';
import { onReconnectOrForeground } from '@/services/network';
import { copy } from '@/ui/copy';

import { createSessionActions, type SessionActions } from './actions';
import { loadDoubtOrigin } from './controller';
import { initialState, sessionReducer, type SessionEvent, type SessionState } from './reducer';
import { FEEDBACK_MS } from './store';

/**
 * Sessions already stopped: their entries saved without signal are retried from the root, wherever the
 * app is; a doubt that comes out of them is asked on screen 1, before picking groups (decided with Jason).
 * Its own state, apart from the active session's.
 */
export const usePastSessionStore = create<{ state: SessionState; dispatch(e: SessionEvent): void }>((set) => ({
  state: initialState,
  dispatch: (event) => set((s) => ({ state: sessionReducer(s.state, event) })),
}));

let actions: SessionActions | null = null;

/** Screen 1 answers the doubt through these. */
export const pastSessionActions = {
  send: (text: string, photo: string | null = null) => void actions?.send(text, photo),
  choose: (exerciseId: string) => void actions?.choose(exerciseId),
  dismiss: () => actions?.dismissDoubt(),
  setText: (text: string) => usePastSessionStore.getState().dispatch({ type: 'TYPE', text }),
  /** Right after CERRAR: what the session left pending is now a stopped session's. */
  retry: () => void actions?.retryPending(),
};

/** Mounted once in the root layout: retries on open, on foreground and when the signal returns. */
export function usePastSessionsRetry(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    const store = usePastSessionStore;
    actions = createSessionActions(
      { db, ai, newId, now: nowIso, today: () => localDateOf(nowIso()), requestSync, photos },
      { sessionId: null, groups: [] },
      () => store.getState().state,
      (e) => store.getState().dispatch(e),
      { unclear: copy.session.unclear, offline: copy.session.offline, unclearRetry: copy.session.unclearRetry },
      { onSessionCreated: () => {}, onChanged: () => {} },
      'ended',
    );
    void actions.retryPending();
    // Photos of entries already understood (or gone) aren't needed anymore.
    void getPhotosInUse(db).then((inUse) => photos.prune(inUse)).catch(() => {});
    const stop = onReconnectOrForeground(() => void actions?.retryPending());

    // "Anotado" stays FEEDBACK_MS on screen 1 too; then the next doubt, if any.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = store.subscribe(({ state }, prev) => {
      if (state.phase === 'feedback' && prev.state.phase !== 'feedback') {
        timer = setTimeout(() => {
          store.getState().dispatch({ type: 'FEEDBACK_DONE' });
          void actions?.retryPending();
        }, FEEDBACK_MS);
      }
    });
    return () => {
      stop();
      unsubscribe();
      clearTimeout(timer);
      actions = null;
    };
  }, [db]);
}

/**
 * Screen 1: the doubt of a stopped session (or its "Anotado" right after answering), with where it
 * came from. `active` false = nothing to show, the picker as usual.
 */
export function usePastDoubt() {
  const db = useSQLiteContext();
  const state = usePastSessionStore((s) => s.state);
  const [origin, setOrigin] = useState<{ dayLabel: string; groupsLabel: string } | null>(null);
  const entryId = state.phase === 'disambiguating' ? state.entryId : null;

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    void loadDoubtOrigin(db, entryId).then((o) => !cancelled && setOrigin(o));
    return () => {
      cancelled = true;
    };
  }, [db, entryId]);

  const active = state.phase !== 'ready';
  return { active, state, origin: active ? origin : null };
}
