import { useCallback, useState } from 'react';

import type { SafetyTarget } from './SafetyFlow';

/** The target a screen's SafetyFlow is open on (null: closed), and how to open and close it. */
export function useSafetyTarget() {
  const [target, setTarget] = useState<SafetyTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);
  return { target, open: setTarget, close };
}
