import { initialPanel, panelMode, panelReducer, type PanelAction, type PanelState } from '../panel';

const run = (...actions: PanelAction[]): PanelState => actions.reduce(panelReducer, initialPanel);

it('starts on the map', () => {
  expect(panelMode(initialPanel)).toBe('map');
});

it('focus opens the panel on Recents, typing shows results, clearing goes back to Recents', () => {
  expect(panelMode(run({ type: 'focus' }))).toBe('recents');
  expect(panelMode(run({ type: 'focus' }, { type: 'type', q: 'co' }))).toBe('results');
  expect(run({ type: 'focus' }, { type: 'type', q: 'co' }, { type: 'clear' })).toEqual({ open: true, q: '' });
});

it('typing opens the panel even without a focus event, and blank text is still Recents', () => {
  expect(panelMode(run({ type: 'type', q: 'topo' }))).toBe('results');
  expect(panelMode(run({ type: 'type', q: '   ' }))).toBe('recents');
});

it('Cancel drops the text and returns to the map from any state', () => {
  for (const before of [run({ type: 'focus' }), run({ type: 'type', q: 'coke' }), initialPanel]) {
    expect(panelReducer(before, { type: 'cancel' })).toEqual(initialPanel);
  }
});

it('focusing an open panel keeps its text', () => {
  const typed = run({ type: 'type', q: 'coke' });
  expect(panelReducer(typed, { type: 'focus' })).toBe(typed);
});
