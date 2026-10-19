/**
 * The Search tab's results panel (TASKS.md M-15, §1c "Inline vs full screen"). Pure, so the
 * transitions are tested without rendering.
 *
 *   map      the panel is down: the map area takes gestures
 *   recents  the bar has focus and is empty: Recents and suggestions
 *   results  the bar has text: grouped Bevs and People
 *
 * Focusing or typing opens the panel; clearing the bar goes back to recents (the panel stays up);
 * Cancel drops the text and slides the panel away, leaving the map where it was.
 */
export interface PanelState {
  open: boolean;
  q: string;
}

export type PanelMode = 'map' | 'recents' | 'results';

export type PanelAction = { type: 'focus' } | { type: 'type'; q: string } | { type: 'clear' } | { type: 'cancel' };

export const initialPanel: PanelState = { open: false, q: '' };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'focus':
      return state.open ? state : { ...state, open: true };
    case 'type':
      return { open: true, q: action.q };
    case 'clear':
      return { ...state, q: '' };
    case 'cancel':
      return initialPanel;
  }
}

export function panelMode(state: PanelState): PanelMode {
  if (!state.open) return 'map';
  return state.q.trim().length === 0 ? 'recents' : 'results';
}
