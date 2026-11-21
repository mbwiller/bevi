import { useEffect, useState } from 'react';

import { currentPosition, positionPermission, type PositionResult } from './position';

export type PositionState = PositionResult | { kind: 'idle' } | { kind: 'locating' };

/**
 * The device's position while `active` (the place picker is open), asked for once per activation.
 *
 * `quiet`: ask only when the answer needs no permission prompt, for a suggestion nobody requested
 * (the note step's "nearby" line). The picker itself is opened by a tap on "Add location", which is
 * the moment a prompt makes sense, so it asks outright.
 */
export function usePosition(active: boolean, quiet = false): PositionState {
  const [state, setState] = useState<PositionState>({ kind: 'idle' });

  useEffect(() => {
    if (!active) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    void (async () => {
      if (quiet && (await positionPermission()) !== 'granted') return;
      if (cancelled) return;
      setState({ kind: 'locating' });
      const result = await currentPosition();
      if (!cancelled) setState(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, quiet]);

  return state;
}
