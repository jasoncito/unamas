import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Exercise } from '@/data/repos/exercises';
import type { PlanLine, Suggestion } from '@/features/session/controller';

import { color } from '../tokens';
import { AmbiguityPanel } from './AmbiguityPanel';
import { Bubble } from './Bubble';
import { TodayList } from './TodayList';
import { GroupsTitle } from './GroupsTitle';
import { InputBar } from './InputBar';
import { PlanTable } from './PlanTable';
import { SuggestionList } from './SuggestionList';

const colorOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).color;

describe('PlanTable (design/meta.html)', () => {
  const lines: PlanLine[] = [
    { exerciseId: 'a', name: 'Press de hombro con mancuernas', loadBasis: 'per_dumbbell', loadKg: 24, reps: [9, 9, 9, 9], loadUp: false, setsUp: true, before: { loadKg: 24, reps: [8, 8, 8, 8] } },
    { exerciseId: 'b', name: 'Sentadilla en máquina Smith', loadBasis: 'per_side', loadKg: 32.5, reps: [6, 6, 6, 6], loadUp: true, setsUp: false, before: { loadKg: 30, reps: [10, 10, 10, 10] } },
  ];

  it('only what goes up is green, with "antes" below; the rest is white without "antes"', async () => {
    await render(<PlanTable title="Hombro y pierna · hoy te toca" lines={lines} />);
    expect(colorOf('4×9')).toBe(color.green);
    expect(screen.getByText('antes 4×8')).toBeTruthy();
    expect(colorOf('24 kg')).toBe(color.text);
    expect(colorOf('32.5 kg')).toBe(color.green);
    expect(screen.getByText('antes 30')).toBeTruthy();
    expect(colorOf('4×6')).toBe(color.text);
    expect(screen.queryByText('antes 4×10')).toBeNull();
  });

  it('shows the header, the columns, and "(por lado)" for per-side loads', async () => {
    await render(<PlanTable title="Hombro y pierna · hoy te toca" lines={lines} />);
    expect(screen.getByText('Hombro y pierna · hoy te toca')).toBeTruthy();
    expect(screen.getByText('Peso')).toBeTruthy();
    expect(screen.getByText('Series')).toBeTruthy();
    expect(screen.getByText('Sentadilla en máquina Smith (por lado)')).toBeTruthy();
  });
});

describe('SuggestionList (screen 3)', () => {
  const ex = { id: 'p', canonicalName: 'Press de hombro en máquina', loadBasis: 'per_side' } as Exercise;
  const items: Suggestion[] = [
    { exercise: ex, highlight: [0, 12], last: { sessionId: 's', loadKg: 20, reps: [12, 12, 12, 12], createdAt: '2026-09-17T23:00:00.000Z', easy: false } },
  ];

  it('bolds the typed part and shows the last set with its per-side load', async () => {
    await render(<SuggestionList items={items} onPick={() => {}} />);
    expect(screen.getByText('Press de hom')).toBeTruthy();
    expect(screen.getByText('20 kg/lado · 4×12')).toBeTruthy();
  });

  it('tapping passes the suggestion back', async () => {
    const onPick = jest.fn();
    await render(<SuggestionList items={items} onPick={onPick} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPick).toHaveBeenCalledWith(items[0]);
  });

  it('nothing to suggest → nothing rendered', async () => {
    await render(<SuggestionList items={[]} onPick={() => {}} />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe('InputBar', () => {
  it('empty → the mic; with text → the send button', async () => {
    const { rerender } = await render(<InputBar value="" placeholder="p" onChangeText={() => {}} />);
    expect(screen.getByLabelText('Dictar')).toBeTruthy();
    expect(screen.queryByLabelText('Enviar')).toBeNull();
    await rerender(<InputBar value="press" placeholder="p" onChangeText={() => {}} />);
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
    expect(screen.queryByLabelText('Dictar')).toBeNull();
  });

  it('shows the placeholder it is given', async () => {
    await render(<InputBar value="" placeholder="press de hombros, 24 kg, 4 de 9" onChangeText={() => {}} />);
    expect(screen.getByPlaceholderText('press de hombros, 24 kg, 4 de 9')).toBeTruthy();
  });

  it('the camera stays visible, empty or with text (design/photo.html)', async () => {
    const onCamera = jest.fn();
    const { rerender } = await render(<InputBar value="" placeholder="p" onChangeText={() => {}} onCamera={onCamera} />);
    expect(screen.getByLabelText('Foto de la máquina')).toBeTruthy();
    await rerender(<InputBar value="press" placeholder="p" onChangeText={() => {}} onCamera={onCamera} />);
    await fireEvent.press(screen.getByLabelText('Foto de la máquina'));
    expect(onCamera).toHaveBeenCalled();
  });

  it('a photo attached: its × removes it, and it can be sent without text', async () => {
    const onRemove = jest.fn();
    await render(<InputBar value="" placeholder="p" onChangeText={() => {}} onCamera={() => {}} photo="file:///p.jpg" onRemovePhoto={onRemove} />);
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Quitar la foto'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('listening: the placeholder says so, and the mic (now green) sends', async () => {
    const onMic = jest.fn();
    await render(<InputBar value="" placeholder="p" onChangeText={() => {}} onMic={onMic} listening />);
    expect(screen.getByPlaceholderText('Escuchando… toca para enviar')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enviar'));
    expect(onMic).toHaveBeenCalled();
  });
});

describe('GroupsTitle', () => {
  it('without entries: "‹" before the groups, and tapping goes back', async () => {
    const onBack = jest.fn();
    await render(<GroupsTitle text="Hombro y tríceps" onBack={onBack} />);
    expect(screen.getByText('‹', { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onBack).toHaveBeenCalled();
  });

  it('with entries (no onBack): just the groups, no "‹" and nothing to tap', async () => {
    await render(<GroupsTitle text="Hombro y tríceps" />);
    expect(screen.getByText('Hombro y tríceps')).toBeTruthy();
    expect(screen.queryByText('‹', { exact: false })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('TodayList (screen 4)', () => {
  beforeEach(async () => {
    await render(
      <TodayList
        lines={[
          { entryId: 'a', exerciseId: 'p', name: 'Press de hombro', loadBasis: 'per_dumbbell', loadKg: 24, reps: [9, 9, 9, 9], comparedTo: '2026-09-27', delta: { kind: 'reps_per_set', diff: 1, tone: 'up' }, createdAt: '2026-09-29T18:00:00.000Z' },
          { entryId: 'b', exerciseId: 'm', name: 'Press en máquina', loadBasis: 'per_side', loadKg: 20, reps: [12, 12, 12, 12], comparedTo: null, delta: { kind: 'new' }, createdAt: '2026-09-29T18:20:00.000Z' },
        ]}
        pending={[{ entryId: 'c', rawText: 'laterales 7,5 4 de 11', createdAt: '2026-09-29T18:10:00.000Z' }]}
      />,
    );
  });

  it('today’s set with its delta and what it is compared with', async () => {
    expect(screen.getByText('Hoy')).toBeTruthy();
    expect(screen.getByText('vs. 27 sep')).toBeTruthy();
    expect(screen.getByText('primera vez')).toBeTruthy();
    expect(screen.getByText(/24 kg · 4×9/)).toBeTruthy();
    expect(screen.getByText(/20 kg\/lado · 4×12/)).toBeTruthy();
    expect(screen.getByText(/\+1$/)).toHaveStyle({ color: color.green });
    expect(screen.getByText(/nuevo$/)).toHaveStyle({ color: color.muted });
  });

  it('what was saved without signal: their words in gray with "pendiente", in the order they said it', async () => {
    expect(screen.getByText('laterales 7,5 4 de 11')).toHaveStyle({ color: color.muted });
    expect(screen.getByText('pendiente')).toHaveStyle({ color: color.muted });
    const order = screen.getAllByText(/Press de hombro|Press en máquina|laterales 7,5/).map((n) => n.props.children);
    expect(order).toEqual(['Press de hombro', 'laterales 7,5 4 de 11', 'Press en máquina']);
  });
});

describe('Bubble (screen 4)', () => {
  it('with a photo: the thumbnail, and the text if any', async () => {
    await render(<Bubble text="" image="file:///p.jpg" pending feedback={null} />);
    expect(screen.queryByText(/./)).toBeNull();
    await screen.rerender(<Bubble text="esta, 25 a cada lado, 3 de 10" image="file:///p.jpg" pending={false} feedback={{ text: 'Anotado · Press de pecho en máquina · primera vez', tone: 'muted' }} />);
    expect(screen.getByText('esta, 25 a cada lado, 3 de 10')).toBeTruthy();
    expect(screen.getByText('Anotado · Press de pecho en máquina · primera vez')).toHaveStyle({ color: color.muted });
  });

  it('pending: dimmed and without a line; then "Anotado" in green only if it went up', async () => {
    await render(<Bubble text="press 24 4 de 9" pending feedback={null} />);
    expect(screen.queryByText(/Anotado/)).toBeNull();
    await screen.rerender(<Bubble text="press 24 4 de 9" pending={false} feedback={{ text: 'Anotado · +1 rep por serie vs. el 27', tone: 'up' }} />);
    expect(screen.getByText('Anotado · +1 rep por serie vs. el 27')).toHaveStyle({ color: color.green });
    await screen.rerender(<Bubble text="press 24 4 de 9" pending={false} feedback={{ text: 'Anotado · igual que el 27', tone: 'muted' }} />);
    expect(screen.getByText('Anotado · igual que el 27')).toHaveStyle({ color: color.muted });
  });
});

describe('AmbiguityPanel (screen 5)', () => {
  it('their phrase, the question and an option per exercise with its last load', async () => {
    const onChoose = jest.fn();
    await render(
      <AmbiguityPanel
        said="laterales con 10, 4 de 11"
        question="¿Cuáles laterales?"
        options={[{ exerciseId: 'polea', label: 'En polea', lastLoadKg: 7.5 }, { exerciseId: 'otra', label: 'Otras', lastLoadKg: null }]}
        onChoose={onChoose}
      />,
    );
    expect(screen.getByText('“laterales con 10, 4 de 11”')).toBeTruthy();
    expect(screen.getByText('última 7.5 kg')).toBeTruthy();
    expect(screen.getByText('sin registro')).toBeTruthy();
    await fireEvent.press(screen.getByText('En polea'));
    expect(onChoose).toHaveBeenCalledWith('polea');
  });
});
