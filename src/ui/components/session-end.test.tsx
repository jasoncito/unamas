import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { SessionSummary } from '@/features/session/controller';
import { haptics } from '@/services/haptics';

import { color } from '../tokens';
import { Flood } from './Flood';
import { PastDoubt } from './PastDoubt';
import { SessionBar } from './SessionBar';
import { HOLD_MS, StopButton } from './StopButton';
import { SummaryView } from './SummaryView';

jest.mock('@/services/haptics', () => ({ haptics: { holdTick: jest.fn(), success: jest.fn() } }));

function Stop(props: { onComplete(): void; tipSignal?: number }) {
  const flood = useSharedValue(0);
  return <StopButton flood={flood} {...props} />;
}

const stop = () => screen.getByRole('button', { name: 'Terminar la sesión' });

describe('StopButton (screen 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('a short tap: "Mantén para terminar" for 2.2 s, and it does not end', async () => {
    const onComplete = jest.fn();
    await render(<Stop onComplete={onComplete} />);
    await fireEvent(stop(), 'pressIn');
    await fireEvent(stop(), 'pressOut');
    expect(screen.getByText('Mantén para terminar')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(2300));
    expect(screen.queryByText('Mantén para terminar')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('let go before 1.5 s: nothing happens', async () => {
    const onComplete = jest.fn();
    await render(<Stop onComplete={onComplete} />);
    await fireEvent(stop(), 'pressIn');
    await act(() => jest.advanceTimersByTime(HOLD_MS - 300));
    await fireEvent(stop(), 'pressOut');
    await act(() => jest.advanceTimersByTime(1000));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText('Mantén para terminar')).toBeNull(); // not a short tap
  });

  it('held 1.5 s: haptics stronger as it goes, success, and it ends once', async () => {
    const onComplete = jest.fn();
    await render(<Stop onComplete={onComplete} />);
    await fireEvent(stop(), 'pressIn');
    await act(() => jest.advanceTimersByTime(HOLD_MS));
    expect(onComplete).toHaveBeenCalledTimes(1);
    // Every 250 ms: Light (0–1) → Medium (2–3) → Heavy (4+).
    expect(jest.mocked(haptics.holdTick).mock.calls.map(([s]) => s)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(haptics.success).toHaveBeenCalled();
    await fireEvent(stop(), 'pressOut');
    await fireEvent(stop(), 'pressIn');
    await act(() => jest.advanceTimersByTime(HOLD_MS));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('"listo" was said: the tip shows', async () => {
    await render(<Stop onComplete={jest.fn()} tipSignal={1} />);
    expect(screen.getByText('Mantén para terminar')).toBeTruthy();
  });

  it('a screen reader can end it without holding', async () => {
    const onComplete = jest.fn();
    await render(<Stop onComplete={onComplete} />);
    await fireEvent(stop(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await fireEvent(stop(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('SessionBar', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-28T18:42:10.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('the groups and the stopwatch from the first entry, ticking', async () => {
    function Bar() {
      const flood = useSharedValue(0);
      return <SessionBar groupsLabel="Hombro" startedAt="2026-09-28T18:00:00.000Z" flood={flood} onEnd={jest.fn()} />;
    }
    await render(<Bar />);
    expect(screen.getByText('Hombro')).toBeTruthy();
    expect(screen.getByText('42:10')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('42:11')).toBeTruthy();
  });
});

const SUMMARY: SessionSummary = {
  dayLabel: 'Lunes 28',
  groupsLabel: 'Hombro',
  duration: '58 min',
  tally: { up: 2, same: 1, down: 0, new: 1 },
  pending: 1,
  rows: [
    {
      exerciseId: 'p', name: 'Press de hombro', loadBasis: 'per_dumbbell', config: { kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2 },
      previous: { date: '2026-09-27', loadKg: 24, reps: [8, 8, 8, 8] }, today: { date: '2026-09-28', loadKg: 24, reps: [9, 9, 9, 9] },
      target: null, verdict: 'up', delta: { kind: 'reps_per_set', diff: 1, tone: 'up' },
    },
    {
      exerciseId: 'm', name: 'Remo al mentón', loadBasis: 'total', config: { kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5 },
      previous: null, today: { date: '2026-09-28', loadKg: 15, reps: [12, 12, 12] }, target: null, verdict: 'new', delta: { kind: 'new' },
    },
  ],
  nextTime: {
    exerciseId: 'q', name: 'Press en máquina', loadBasis: 'per_side', config: { kind: 'compound', repFloor: 8, repTop: 12, stepKg: 2.5 },
    previous: null, today: { date: '2026-09-28', loadKg: 20, reps: [12, 12, 12, 12] },
    target: { reason: 'add_load', loadKg: 22.5, reps: [8, 8, 8, 8], gapDays: 0, effectiveTop: 12 },
  },
};

describe('Flood (screen 6)', () => {
  function F({ summary }: { summary: SessionSummary | null }) {
    const flood = useSharedValue(1);
    return <Flood flood={flood} summary={summary} />;
  }

  it('while holding: only green, no words', async () => {
    await render(<F summary={null} />);
    expect(screen.queryByText('Sesión terminada')).toBeNull();
  });

  it('ended: the count in ink and the minutes', async () => {
    await render(<F summary={SUMMARY} />);
    for (const t of ['Sesión terminada', '2 subieron', '1 igual', '1 nuevo', '58 min']) expect(screen.getByText(t)).toHaveStyle({ color: color.ink });
  });
});

describe('SummaryView (screen 7)', () => {
  it('header, count with its colors, pending, each against its last time, next time in bold, CERRAR', async () => {
    const onClose = jest.fn();
    await render(<SummaryView summary={SUMMARY} onClose={onClose} />);
    expect(screen.getByText('Lunes 28 · Hombro · 58 min')).toBeTruthy();
    expect(screen.getByText('2 subieron')).toHaveStyle({ color: color.green });
    expect(screen.getByText('1 igual')).toHaveStyle({ color: color.text });
    expect(screen.getByText('1 nuevo')).toHaveStyle({ color: color.muted });
    expect(screen.getByText('1 pendiente, se anota cuando haya señal')).toBeTruthy();
    expect(screen.getByText('27 sep')).toBeTruthy();
    expect(screen.getByText('4×8')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(screen.getByText('24 kg · 4×9')).toBeTruthy();
    expect(screen.getByText('+1')).toHaveStyle({ color: color.green });
    expect(screen.getByText('primera vez')).toBeTruthy();
    expect(screen.getByText('nuevo')).toHaveStyle({ color: color.muted });
    expect(screen.getByText('Sube a 22.5 kg/lado')).toHaveStyle({ fontWeight: '700' });
    await fireEvent.press(screen.getByText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('no next time worth saying: no section', async () => {
    await render(<SummaryView summary={{ ...SUMMARY, nextTime: null, pending: 0 }} onClose={jest.fn()} />);
    expect(screen.queryByText('La próxima vez')).toBeNull();
    expect(screen.queryByText(/pendiente/)).toBeNull();
  });
});

describe('PastDoubt (screen 1)', () => {
  it('where it comes from, the question, and "Ahora no"', async () => {
    const onNotNow = jest.fn();
    const onChoose = jest.fn();
    await render(
      <PastDoubt
        state={{ phase: 'disambiguating', text: '', logged: 0, entryId: 'e', said: 'laterales con 10, 4 de 11', image: null, question: '¿Cuáles laterales?', options: [{ exerciseId: 'polea', label: 'En polea', lastLoadKg: 7.5 }] }}
        origin={{ dayLabel: 'Lunes 28', groupsLabel: 'Hombro' }}
        onChoose={onChoose}
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onMic={jest.fn()}
        listening={false}
        notice={null}
        onNotNow={onNotNow}
      />,
    );
    expect(screen.getByText('De tu sesión del lunes 28 · Hombro')).toBeTruthy();
    expect(screen.getByText('¿Cuáles laterales?')).toBeTruthy();
    await fireEvent.press(screen.getByText('En polea'));
    expect(onChoose).toHaveBeenCalledWith('polea');
    await fireEvent.press(screen.getByText('Ahora no'));
    expect(onNotNow).toHaveBeenCalled();
  });
});
