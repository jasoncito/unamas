import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Exercise } from '@/data/repos/exercises';
import type { GroupSection, PlanLine, Suggestion, TodayLine } from '@/features/session/controller';

import { color } from '../tokens';
import { AmbiguityPanel } from './AmbiguityPanel';
import { Bubble } from './Bubble';
import { TodayList } from './TodayList';
import { GroupsTitle } from './GroupsTitle';
import { InputBar } from './InputBar';
import { ExerciseSection } from './ExerciseSection';
import { SuggestionList } from './SuggestionList';

const colorOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).color;

describe('ExerciseSection (design/flujo-ejercicio.html, design/meta.html)', () => {
  const lines: PlanLine[] = [
    { exerciseId: 'a', name: 'Press de hombro con mancuernas', loadBasis: 'per_dumbbell', loadKg: 24, reps: [9, 9, 9, 9], loadUp: false, setsUp: true, before: { loadKg: 24, reps: [8, 8, 8, 8] } },
    { exerciseId: 'b', name: 'Sentadilla en máquina Smith', loadBasis: 'per_side', loadKg: 32.5, reps: [6, 6, 6, 6], loadUp: true, setsUp: false, before: { loadKg: 30, reps: [10, 10, 10, 10] } },
  ];
  const done: TodayLine = {
    entryId: 'e', exerciseId: 'c', name: 'Extensión de pierna', loadBasis: 'stack', loadKg: 70, reps: [11, 11, 11, 11], comparedTo: '2026-09-24',
    delta: { kind: 'reps_per_set', diff: 1, tone: 'up' }, createdAt: '2026-09-29T18:00:00.000Z',
  };
  const section = (over: Partial<GroupSection> = {}): GroupSection => ({
    group: 'legs', label: 'Pierna', lastDate: '2026-09-24', rows: lines.map((line) => ({ kind: 'todo', line })), ...over,
  });
  const handlers = () => ({ onHistory: jest.fn(), onPick: jest.fn(), onResume: jest.fn(), onDelete: jest.fn() });

  it('only what goes up is green, with "antes" below; the rest is white without "antes"', async () => {
    await render(<ExerciseSection section={section()} {...handlers()} />);
    expect(colorOf('4×9')).toBe(color.green);
    expect(screen.getByText('antes 4×8')).toBeTruthy();
    expect(colorOf('24 kg')).toBe(color.text);
    expect(colorOf('32.5 kg')).toBe(color.green);
    expect(screen.getByText('antes 30')).toBeTruthy();
    expect(colorOf('4×6')).toBe(color.text);
    expect(screen.queryByText('antes 4×10')).toBeNull();
  });

  it('the header says the group and its last time, never "hoy te toca"; "por lado" under the load', async () => {
    await render(<ExerciseSection section={section()} {...handlers()} />);
    expect(screen.getByText(/Pierna · tu última vez, 24 sep/)).toBeTruthy();
    expect(screen.queryByText(/hoy te toca/i)).toBeNull();
    expect(screen.getByText('Peso')).toBeTruthy();
    expect(screen.getByText('Series')).toBeTruthy();
    expect(screen.getAllByText('por lado')).toHaveLength(1);
    expect(screen.getByText('vuelves a 6')).toBeTruthy();
  });

  it('tapping the header opens the group’s history; tapping a row, its weight', async () => {
    const h = handlers();
    await render(<ExerciseSection section={section()} {...h} />);
    await fireEvent.press(screen.getByText(/tu última vez/));
    expect(h.onHistory).toHaveBeenCalledWith('legs');
    await fireEvent.press(screen.getByText('Sentadilla en máquina Smith'));
    expect(h.onPick).toHaveBeenCalledWith('b');
  });

  it('a started exercise says "en curso" and goes back to it', async () => {
    const h = handlers();
    const draft = { id: 'd', sessionId: 's', exerciseId: 'b', loadKg: 32.5, createdAt: '' };
    await render(<ExerciseSection section={section({ rows: [{ kind: 'draft', line: lines[1], name: lines[1].name, exerciseId: 'b', draft }] })} {...h} />);
    expect(screen.getByText('en curso')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sentadilla en máquina Smith'));
    expect(h.onResume).toHaveBeenCalledWith('d');
    expect(h.onPick).not.toHaveBeenCalled();
  });

  it('done today: what was done and its comparison, green when it went up; tap, then "Borrar"', async () => {
    const h = handlers();
    await render(<ExerciseSection section={section({ rows: [{ kind: 'done', line: done }] })} {...h} />);
    expect(screen.getByText('4×11')).toBeTruthy();
    expect(colorOf('+1')).toBe(color.green);
    await fireEvent.press(screen.getByText('Extensión de pierna'));
    await fireEvent.press(screen.getByText('Borrar'));
    expect(h.onDelete).toHaveBeenCalledWith('e');
    expect(h.onPick).not.toHaveBeenCalled();
  });

  it('a group without history: "sin registro", no columns, no rows', async () => {
    const h = handlers();
    await render(<ExerciseSection section={section({ lastDate: null, rows: [] })} {...h} />);
    expect(screen.getByText('Pierna · sin registro')).toBeTruthy();
    expect(screen.queryByText('Peso')).toBeNull();
    await fireEvent.press(screen.getByText('Pierna · sin registro'));
    expect(h.onHistory).not.toHaveBeenCalled();
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

  it('typing shows at once, even before the store answers; a value from outside replaces it', async () => {
    const onChangeText = jest.fn();
    const { rerender } = await render(<InputBar value="" placeholder="p" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByPlaceholderText('p'), 'press');
    expect(screen.getByDisplayValue('press')).toBeTruthy(); // the prop is still ""
    expect(onChangeText).toHaveBeenCalledWith('press');
    await rerender(<InputBar value="Press de hombro con mancuernas, " placeholder="p" onChangeText={onChangeText} />);
    expect(screen.getByDisplayValue('Press de hombro con mancuernas, ')).toBeTruthy();
    await rerender(<InputBar value="" placeholder="p" onChangeText={onChangeText} />); // sent
    expect(screen.queryByDisplayValue('Press de hombro con mancuernas, ')).toBeNull();
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

  it('listening: the placeholder says so, and the mic (now green) only stops — it never sends', async () => {
    const onMic = jest.fn();
    const onSend = jest.fn();
    await render(<InputBar value="press 24" placeholder="p" onChangeText={() => {}} onMic={onMic} onSend={onSend} listening />);
    expect(screen.queryByLabelText('Enviar')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Dejar de escuchar'));
    expect(onMic).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('listening with nothing heard yet: the placeholder says how to stop', async () => {
    await render(<InputBar value="" placeholder="p" onChangeText={() => {}} onMic={() => {}} listening />);
    expect(screen.getByPlaceholderText('Escuchando… toca el micrófono para parar')).toBeTruthy();
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

describe('TodayList: "Borrar"', () => {
  const line = { entryId: 'a', exerciseId: 'p', name: 'Press de hombro', loadBasis: 'per_dumbbell' as const, loadKg: 24, reps: [9, 9, 9, 9], comparedTo: '2026-09-27', delta: { kind: 'reps_per_set' as const, diff: 1, tone: 'up' as const }, createdAt: '2026-09-29T18:00:00.000Z' };

  it('tapping a row shows "Borrar" in place of its value; tapping it deletes that entry', async () => {
    const onDelete = jest.fn();
    await render(<TodayList lines={[line]} pending={[{ entryId: 'b', rawText: 'laterales 7,5', createdAt: '2026-09-29T18:10:00.000Z' }]} onDelete={onDelete} />);
    expect(screen.queryByText('Borrar')).toBeNull();
    await fireEvent.press(screen.getByText('Press de hombro'));
    expect(screen.getByText('Borrar')).toBeTruthy();
    expect(screen.queryByText(/24 kg · 4×9/)).toBeNull();
    await fireEvent.press(screen.getByText('Borrar'));
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(screen.queryByText('Borrar')).toBeNull();
  });

  it('tapping the row again hides it; a pending row can be deleted too', async () => {
    const onDelete = jest.fn();
    await render(<TodayList lines={[line]} pending={[{ entryId: 'b', rawText: 'laterales 7,5', createdAt: '2026-09-29T18:10:00.000Z' }]} onDelete={onDelete} />);
    await fireEvent.press(screen.getByText('Press de hombro'));
    await fireEvent.press(screen.getByText('Press de hombro'));
    expect(screen.queryByText('Borrar')).toBeNull();
    await fireEvent.press(screen.getByText('laterales 7,5'));
    await fireEvent.press(screen.getByText('Borrar'));
    expect(onDelete).toHaveBeenCalledWith('b');
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
  it('"Deshacer" at the end of "Anotado", never green', async () => {
    const onUndo = jest.fn();
    await render(<Bubble text="press 24 4 de 9" pending={false} feedback={{ text: 'Anotado · +1 rep por serie vs. el 27', tone: 'up' }} onUndo={onUndo} />);
    expect(screen.getByText('Deshacer')).toHaveStyle({ color: color.text });
    await fireEvent.press(screen.getByRole('button', { name: 'Deshacer' }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('without onUndo (waiting, or a retry), no "Deshacer"', async () => {
    await render(<Bubble text="press" pending feedback={null} />);
    expect(screen.queryByText('Deshacer')).toBeNull();
  });

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
