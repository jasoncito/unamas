import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Exercise } from '@/data/repos/exercises';
import type { PlanLine, Suggestion } from '@/features/session/controller';

import { color } from '../tokens';
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
    { exercise: ex, highlight: [0, 12], last: { sessionId: 's', loadKg: 20, reps: [12, 12, 12, 12], createdAt: '2026-09-17T23:00:00.000Z' } },
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
});
