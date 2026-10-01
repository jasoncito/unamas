import { initialState, sessionReducer, type SessionEvent, type SessionState } from './reducer';

const run = (events: SessionEvent[], from: SessionState = initialState) => events.reduce(sessionReducer, from);
const FB = { text: 'Anotado · +1 rep por serie vs. el 27', tone: 'up' as const };

describe('sessionReducer', () => {
  it('typing keeps the text', () => {
    expect(run([{ type: 'TYPE', text: 'press' }])).toMatchObject({ phase: 'ready', text: 'press' });
  });

  it('sending: the bubble shows the text and the input empties', () => {
    expect(run([{ type: 'TYPE', text: 'press 24 4 de 9' }, { type: 'SENT', text: 'press 24 4 de 9' }])).toEqual({
      phase: 'sending',
      text: '',
      logged: 0,
      bubble: 'press 24 4 de 9',
    });
  });

  it('logged → feedback under the bubble, counting entries; then back to ready', () => {
    const s = run([{ type: 'SENT', text: 'x' }, { type: 'LOGGED', feedback: FB, count: 1 }]);
    expect(s).toMatchObject({ phase: 'feedback', bubble: 'x', feedback: FB, logged: 1 });
    expect(sessionReducer(s, { type: 'FEEDBACK_DONE' })).toEqual({ phase: 'ready', text: '', logged: 1, reply: null });
  });

  it('typing during the feedback keeps what was typed', () => {
    const s = run([{ type: 'SENT', text: 'x' }, { type: 'LOGGED', feedback: FB, count: 1 }, { type: 'TYPE', text: 'lat' }, { type: 'FEEDBACK_DONE' }]);
    expect(s).toMatchObject({ phase: 'ready', text: 'lat' });
  });

  it('a stray LOGGED or FEEDBACK_DONE changes nothing', () => {
    expect(sessionReducer(initialState, { type: 'LOGGED', feedback: FB, count: 1 })).toBe(initialState);
    expect(sessionReducer(initialState, { type: 'FEEDBACK_DONE' })).toBe(initialState);
  });

  it('a doubt → disambiguating with the phrase, the question and the options', () => {
    const options = [{ exerciseId: 'polea', label: 'En polea', lastLoadKg: 7.5 }];
    const s = run([{ type: 'SENT', text: 'laterales con 10' }, { type: 'ASK', entryId: 'e1', said: 'laterales con 10', question: '¿Cuáles laterales?', options }]);
    expect(s).toEqual({ phase: 'disambiguating', text: '', logged: 0, entryId: 'e1', said: 'laterales con 10', question: '¿Cuáles laterales?', options });
  });

  it('a reply (not understood, a question, "listo") → ready with the reply shown', () => {
    expect(run([{ type: 'SENT', text: 'hola' }, { type: 'REPLY', reply: 'No te entendí' }])).toEqual({
      phase: 'ready',
      text: '',
      logged: 0,
      reply: 'No te entendí',
    });
  });

  const SUMMARY = { dayLabel: 'Lunes 28', groupsLabel: 'Hombro', duration: '58 min', rows: [], tally: { up: 0, same: 0, down: 0, new: 0 }, pending: 0, nextTime: null };

  it('"listo" → the stop tip, bumped each time, without a reply', () => {
    const once = run([{ type: 'SENT', text: 'listo' }, { type: 'SHOW_STOP_TIP' }]);
    expect(once).toEqual({ phase: 'ready', text: '', logged: 0, reply: null, stopTip: 1 });
    expect(sessionReducer(once, { type: 'SHOW_STOP_TIP' })).toMatchObject({ stopTip: 2 });
  });

  it('"Ahora no" on a doubt → ready; elsewhere nothing', () => {
    const asked = run([{ type: 'ASK', entryId: 'e1', said: 'x', question: '?', options: [] }]);
    expect(sessionReducer(asked, { type: 'DISMISS' })).toEqual({ phase: 'ready', text: '', logged: 0, reply: null });
    expect(sessionReducer(initialState, { type: 'DISMISS' })).toBe(initialState);
  });

  it('the stop: ending (green) → summary after the flood; nothing else moves it', () => {
    const ending = run([{ type: 'TYPE', text: 'lat' }, { type: 'ENDED', summary: SUMMARY }]);
    expect(ending).toEqual({ phase: 'ending', text: '', logged: 0, summary: SUMMARY });
    for (const e of [
      { type: 'LOGGED', feedback: FB, count: 1 },
      { type: 'REPLY', reply: 'Sin señal' },
      { type: 'ASK', entryId: 'e', said: 'x', question: '?', options: [] },
      { type: 'SENT', text: 'x' },
      { type: 'TYPE', text: 'x' },
      { type: 'SHOW_STOP_TIP' },
    ] as SessionEvent[]) {
      expect(sessionReducer(ending, e)).toBe(ending);
    }
    const summary = sessionReducer(ending, { type: 'FLOOD_DONE' });
    expect(summary).toEqual({ phase: 'summary', text: '', logged: 0, summary: SUMMARY });
    expect(sessionReducer(summary, { type: 'FLOOD_DONE' })).toBe(summary);
    expect(sessionReducer(initialState, { type: 'FLOOD_DONE' })).toBe(initialState);
  });
});
