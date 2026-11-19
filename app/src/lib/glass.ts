import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Bevi never renders real glass (the native GlassView on iOS 26+). What remains here is the
// viewer's Reduce Transparency setting. This is the native file; the web one, glass.web.ts, reads
// `prefers-reduced-transparency`.

/** The viewer's Reduce Transparency setting (iOS Settings › Accessibility), live. Off until known. */
export function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    let changed = false;
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (on: boolean) => {
      changed = true;
      setReduced(on);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then(
      (on) => {
        // A change event that arrived first is newer than this answer.
        if (live && !changed) setReduced(on);
      },
      () => {},
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
