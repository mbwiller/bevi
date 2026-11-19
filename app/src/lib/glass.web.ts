import { useEffect, useState } from 'react';

// Bevi never renders real glass (the native GlassView on iOS 26+) and never imitates it with CSS
// `backdrop-filter`. What remains here is the viewer's Reduce Transparency setting, which the map
// honours. This is the web file; the native one, glass.ts, asks AccessibilityInfo.

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
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(REDUCED_TRANSPARENCY);
}
