import { Keyboard } from 'react-native';

import { levelsForTarget } from './pickNative';
import { setTouchListener, type AppTouch, type TouchListener } from './touchRoot';
import type { PickLevel, PickModeHandlers } from './types';

/**
 * Select mode, the iOS file (pickMode.web.ts is the web one, which listens on `document`): while it
 * is on, a tap on the app selects the component under it instead of pressing it.
 *
 * The tap is heard and kept from the app by the View around the app's screens (ReportTouchRoot.tsx,
 * through touchRoot.ts), which becomes the touch's responder for as long as select mode is on, so
 * no Pressable under it is pressed. What the finger is on is shown as soon as it lands; lifting it
 * in the same place selects, and a finger that travelled selects nothing. Unlike the web, the app
 * does not scroll meanwhile: iOS holds a scroll view still while a view above it has the touch
 * (ReportTouchRoot.tsx), so the tester scrolls first and selects then.
 *
 * One thing React Native cannot keep a tap from is a text field, which UIKit focuses by itself: a
 * tap that selects a field also raises the keyboard, so the keyboard is dismissed again.
 *
 * Touches on the reporter's own layer never get here: it is drawn beside the app, not inside that
 * View.
 */

export type { PickModeHandlers };

let handlers: PickModeHandlers | null = null;
let hoverCleared = true;

function hover(levels: PickLevel[]): void {
  if (levels.length === 0 && hoverCleared) return;
  hoverCleared = levels.length === 0;
  try {
    handlers?.onHover(levels);
  } catch {
    // A handler's own error is the UI's to see; select mode carries on.
  }
}

function tap(touch: AppTouch): void {
  const levels = levelsForTarget(touch.target);
  if (levels.length === 0) {
    hover([]);
    return;
  }
  try {
    Keyboard.dismiss();
  } catch {
    // No keyboard to put away.
  }
  try {
    handlers?.onPick(levels);
  } catch {
    // As above.
  }
}

/**
 * Turns select mode on and returns the function that turns it off. While it is on a tap on the app
 * presses nothing and is reported through `onPick` (`onHover` says what the finger is on meanwhile,
 * and [] when it has left); anything in the reporter's own layer behaves normally. Starting again
 * hands over to the new handlers, and the old stop then does nothing. Never throws.
 */
export function startPickMode(next: PickModeHandlers): () => void {
  try {
    handlers = next;
    hoverCleared = true;
    const mine: TouchListener = {
      onDown: (touch) => hover(levelsForTarget(touch.target)),
      onDrift: () => hover([]),
      onTap: tap,
    };
    setTouchListener('select', mine);
    return (): void => {
      try {
        if (handlers !== next) return;
        handlers = null;
        hoverCleared = true;
        setTouchListener('select', null, mine);
      } catch {
        // Turning off never throws.
      }
    };
  } catch {
    return () => {};
  }
}

/** Whether select mode is on. */
export function isPickModeOn(): boolean {
  return handlers !== null;
}
