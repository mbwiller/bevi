import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** The part of `window.visualViewport` the inset is computed from. */
export interface VisualViewportLike {
  height: number;
  offsetTop: number;
  scale: number;
}

/**
 * How much of the layout viewport's bottom the on-screen keyboard hides, in px. iOS Safari (and the
 * home-screen web app) doesn't resize the page for the keyboard: it shrinks and pans the visual
 * viewport over a layout viewport that keeps its height, so a `position: fixed` sheet's bottom ends
 * up behind the keyboard. What lies below the visual viewport is the keyboard. While pinch-zoomed the
 * visual viewport is small for another reason, so the inset is 0 then.
 */
export function keyboardInsetFrom(innerHeight: number, vv: VisualViewportLike): number {
  if (vv.scale > 1.01) return 0;
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
}

/**
 * The keyboard's height over the bottom of the screen while it is open, else 0, for content pinned
 * to the bottom (a composer) to pad itself above it. Web: from `visualViewport` resize and scroll
 * events. Native (unused while the app is web-only): the Keyboard module's show and hide events.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }
    if (Platform.OS === 'web') {
      const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
      if (!vv) return;
      const update = () => setInset(keyboardInsetFrom(window.innerHeight, vv));
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setInset(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);

  return inset;
}
