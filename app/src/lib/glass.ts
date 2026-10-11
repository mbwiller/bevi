import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Bevi is a web app: "real glass" is CSS `backdrop-filter`, which Safari (the iPhone home-screen app)
// and every current desktop browser have. Where it's missing, or the viewer asks for less
// transparency, glass gives way to the design system's tint material; it is never imitated.

let backdropSupport: boolean | undefined;

/** Whether the browser can blur what's behind an element. Checked once; always false off the web. */
export function supportsBackdropFilter(): boolean {
  if (backdropSupport === undefined) {
    backdropSupport =
      Platform.OS === 'web' &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  }
  return backdropSupport;
}

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

/** The viewer's Reduce Transparency setting (`prefers-reduced-transparency`), live. */
export function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function query(): MediaQueryList | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(REDUCED_TRANSPARENCY);
}
