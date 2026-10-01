import { usePicker } from './store';

beforeEach(() => usePicker.getState().reset());

describe('usePicker', () => {
  it('keeps the tap order, which is the session order', () => {
    const { toggle } = usePicker.getState();
    toggle('triceps');
    toggle('shoulders');
    expect(usePicker.getState().selected).toEqual(['triceps', 'shoulders']);
  });

  it('tapping again deselects, and the rest renumber', () => {
    const { toggle } = usePicker.getState();
    toggle('shoulders');
    toggle('triceps');
    toggle('chest');
    toggle('shoulders');
    expect(usePicker.getState().selected).toEqual(['triceps', 'chest']);
  });

  it('"Otro…" adds a custom group, selected, lowercase and trimmed, once', () => {
    const { addCustom } = usePicker.getState();
    addCustom('  Antebrazo ');
    addCustom('antebrazo');
    addCustom('   ');
    expect(usePicker.getState()).toMatchObject({ custom: ['antebrazo'], selected: ['antebrazo'] });
  });
});
