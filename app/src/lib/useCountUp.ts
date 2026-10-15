import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { motion } from '@/theme';

/** About one frame at 60 Hz. */
const FRAME_MS = 16;

/** Ease-out cubic: quick at first, settling onto the target. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts from `from` to `target` over `duration` ms (default `motion.pour`), for text
 * that can't be a transform (the ScoreBubble's number on the ranking note step). JS-driven with
 * timers; the last value is exactly `target`. Under Reduce Motion it is `target` from the start.
 * Restarts from `from` whenever `target` or `from` changes.
 */
export function useCountUp(target: number, from: number, duration: number = motion.pour): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : from);

  useEffect(() => {
    if (reduced || duration <= 0 || from === target) {
      setValue(target);
      return;
    }
    setValue(from);
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= duration) {
        setValue(target);
        return;
      }
      setValue(from + (target - from) * easeOut(elapsed / duration));
      // Land the last tick on `duration` itself rather than up to a frame after it.
      timer = setTimeout(tick, Math.min(FRAME_MS, duration - elapsed));
    };
    timer = setTimeout(tick, Math.min(FRAME_MS, duration));
    return () => clearTimeout(timer);
  }, [target, from, duration, reduced]);

  return reduced ? target : value;
}
