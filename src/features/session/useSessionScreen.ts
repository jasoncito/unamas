import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { newId, nowIso } from '@/data/ids';
import { endStaleSessions, getOpenSession } from '@/data/repos/sessions';
import { localDateOf } from '@/domain/dates';
import { usePicker } from '@/features/picker/store';
import { requestSync } from '@/features/sync/useSync';
import { ai } from '@/services/aiClient';
import { haptics } from '@/services/haptics';
import { photos } from '@/services/image';
import { onReconnectOrForeground } from '@/services/network';
import { copy } from '@/ui/copy';

import { createSessionActions, type SessionActions, type SessionContext } from './actions';
import { loadSessionScreen, type SessionScreen } from './controller';
import { FEEDBACK_MS, FLOOD_MS, useSessionStore } from './store';

const today = () => localDateOf(nowIso());

/**
 * Screens 2–5 wiring: loads the screen from SQLite, creates the session's actions once, runs the
 * "Anotado" timer and reloads the lists when something was logged. Null `screen` = still loading;
 * `onMissing` runs when there's neither an open session nor chosen groups.
 */
export function useSessionScreen(pendingGroups: string[] | null, onMissing: () => void, pendingStartedAt: string | null = null) {
  const db = useSQLiteContext();
  const { state, dispatch, reset } = useSessionStore();
  const [screen, setScreen] = useState<SessionScreen | null>(null);
  const actions = useRef<SessionActions | null>(null);
  const shownLogged = useRef(0);
  const pendingKey = JSON.stringify(pendingGroups);

  const reload = useCallback(async () => {
    // Once the stop completes, the summary stays: nothing reloads under it.
    const phase = useSessionStore.getState().state.phase;
    if (phase === 'ending' || phase === 'summary') return;
    const s = await loadSessionScreen(db, today(), pendingGroups, pendingStartedAt);
    if (!s) return onMissing();
    setScreen(s);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, pendingKey, pendingStartedAt]);

  // First load: a fresh state, the actions for this session, and whatever was left unresolved.
  useEffect(() => {
    reset();
    shownLogged.current = 0;
    let cancelled = false;
    let stopWatching = () => {};
    void reload().then((s) => {
      if (!s || cancelled) return;
      const ctx: SessionContext = { sessionId: s.sessionId, groups: s.groups, startedAt: s.startedAt };
      actions.current = createSessionActions(
        { db, ai, newId, now: nowIso, today, requestSync, photos },
        ctx,
        () => useSessionStore.getState().state,
        useSessionStore.getState().dispatch,
        { unclear: copy.session.unclear, offline: copy.session.offline, unclearRetry: copy.session.unclearRetry },
        {
          onSessionCreated: () => void reload(), // the session exists now: no more going back
          onChanged: () => void reload(), // a retry turned a pending row into a logged one
        },
      );
      // Entries saved without signal: retried now, and on every new chance to reach the network.
      void actions.current.retryPending();
      stopWatching = onReconnectOrForeground(async () => {
        // Back after hours with the stop never held: that session was closed; start on screen 1.
        if (ctx.sessionId && (await endStaleSessions(db, nowIso())) > 0 && !(await getOpenSession(db))) {
          usePicker.getState().reset();
          return onMissing();
        }
        void actions.current?.retryPending();
      });
    });
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [db, reload, reset]);

  // The bubble stays FEEDBACK_MS, then goes to the list. Keyed on each new "Anotado" (logged moves on
  // every LOGGED), so typing meanwhile neither restarts the countdown nor buzzes again.
  const feedbackKey = state.phase === 'feedback' ? `${state.logged}:${state.feedback.tone}` : null;
  useEffect(() => {
    if (!feedbackKey) return;
    haptics.logged(feedbackKey.endsWith(':up'));
    const t = setTimeout(() => dispatch({ type: 'FEEDBACK_DONE' }), FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [feedbackKey, dispatch]);

  // The screen stays green with the count FLOOD_MS, then recedes to the summary.
  useEffect(() => {
    if (state.phase !== 'ending') return;
    const t = setTimeout(() => dispatch({ type: 'FLOOD_DONE' }), FLOOD_MS);
    return () => clearTimeout(t);
  }, [state.phase, dispatch]);

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
    send: (text: string, photo: string | null = null) => void actions.current?.send(text, photo),
    choose: (exerciseId: string) => void actions.current?.choose(exerciseId),
    /** "Borrar" on a row of "Hoy". */
    deleteEntry: (entryId: string) => void actions.current?.deleteEntry(entryId),
    /** "Deshacer" during "Anotado". */
    undo: () => actions.current?.undo() ?? Promise.resolve(null),
    /** The stop completed. Null if there was nothing to end. */
    end: () => actions.current?.end() ?? Promise.resolve(null),
    /** CERRAR: a fresh state for the next session, and screen 1 with nothing selected. */
    close: () => {
      reset();
      usePicker.getState().reset();
    },
  };
}
