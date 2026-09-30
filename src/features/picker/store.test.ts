import { usePicker } from './store';

beforeEach(() => usePicker.getState().reset());

describe('usePicker', () => {
  it('keeps the tap order, which is the session order', () => {
    const { toggle } = usePicker.getState();
    toggle('tríceps');
    toggle('hombro');
    expect(usePicker.getState().selected).toEqual(['tríceps', 'hombro']);
  });

  it('tapping again deselects, and the rest renumber', () => {
    const { toggle } = usePicker.getState();
    toggle('hombro');
    toggle('tríceps');
    toggle('pecho');
    toggle('hombro');
    expect(usePicker.getState().selected).toEqual(['tríceps', 'pecho']);
  });

  it('"Otro…" adds a custom group, selected, lowercase and trimmed, once', () => {
    const { addCustom } = usePicker.getState();
    addCustom('  Antebrazo ');
    addCustom('antebrazo');
    addCustom('   ');
    expect(usePicker.getState()).toMatchObject({ custom: ['antebrazo'], selected: ['antebrazo'] });
  });
});
