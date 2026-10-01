import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { newId, nowIso } from '@/data/ids';
import { localDateOf } from '@/domain/dates';
import { requestSync } from '@/features/sync/useSync';
import { ai } from '@/services/aiClient';
import { onReconnectOrForeground } from '@/services/network';
import { copy } from '@/ui/copy';

import { createSessionActions, type SessionActions, type SessionContext } from './actions';
import { loadSessionScreen, type SessionScreen } from './controller';
import { FEEDBACK_MS, useSessionStore } from './store';

const today = () => localDateOf(nowIso());

/**
 * Screens 2–5 wiring: loads the screen from SQLite, creates the session's actions once, runs the
 * "Anotado" timer and reloads the lists when something was logged. Null `screen` = still loading;
 * `onMissing` runs when there's neither an open session nor chosen groups.
 */
export function useSessionScreen(pendingGroups: string[] | null, onMissing: () => void) {
  const db = useSQLiteContext();
  const { state, dispatch, reset } = useSessionStore();
  const [screen, setScreen] = useState<SessionScreen | null>(null);
  const actions = useRef<SessionActions | null>(null);
  const shownLogged = useRef(0);
  const pendingKey = JSON.stringify(pendingGroups);

  const reload = useCallback(async () => {
    const s = await loadSessionScreen(db, today(), pendingGroups);
    if (!s) return onMissing();
    setScreen(s);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, pendingKey]);

  // First load: a fresh state, the actions for this session, and whatever was left unresolved.
  useEffect(() => {
    reset();
    shownLogged.current = 0;
    let cancelled = false;
    let stopWatching = () => {};
    void reload().then((s) => {
      if (!s || cancelled) return;
      const ctx: SessionContext = { sessionId: s.sessionId, groups: s.groups };
      actions.current = createSessionActions(
        { db, ai, newId, now: nowIso, today, requestSync },
        ctx,
        () => useSessionStore.getState().state,
        useSessionStore.getState().dispatch,
        { unclear: copy.session.unclear, offline: copy.session.offline, stopTip: copy.session.stopTip, unclearRetry: copy.session.unclearRetry },
        {
          onSessionCreated: () => void reload(), // the session exists now: no more going back
          onChanged: () => void reload(), // a retry turned a pending row into a logged one
        },
      );
      // Entries saved without signal: retried now, and on every new chance to reach the network.
      void actions.current.retryPending();
      stopWatching = onReconnectOrForeground(() => void actions.current?.retryPending());
    });
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [db, reload, reset]);

  // The bubble stays FEEDBACK_MS, then goes to the list.
  useEffect(() => {
    if (state.phase !== 'feedback') return;
    const t = setTimeout(() => dispatch({ type: 'FEEDBACK_DONE' }), FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [state, dispatch]);

  // "Hoy" catches up once a message is done: logged (after the bubble is gone), or left pending
  // without signal. Not while one is on its way, or it would show twice: bubble and pending row.
  const lastPhase = useRef(state.phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    if (state.phase === 'sending' || state.phase === 'feedback') return;
    if (was !== 'sending' && was !== 'feedback' && state.logged === shownLogged.current) return;
    shownLogged.current = state.logged;
    void reload();
  }, [state.phase, state.logged, reload]);

  return {
    screen,
    state,
    setText: (text: string) => dispatch({ type: 'TYPE', text }),
    send: (text: string) => void actions.current?.send(text),
    choose: (exerciseId: string) => void actions.current?.choose(exerciseId),
  };
}
