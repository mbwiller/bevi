import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Bevi is web-only, so it never renders real glass (the native GlassView on iOS 26+) and never imitates it
// with CSS `backdrop-filter`. What remains here is the viewer's Reduce Transparency setting, which
// BevGlow honours by dropping its blur.

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
