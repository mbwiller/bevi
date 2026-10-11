import { useEffect, useState } from 'react';

/** Search waits this long after the last keystroke (DEVELOPMENT-MATT §6.8). */
export const SEARCH_DEBOUNCE_MS = 250;

/** `value`, updated only once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
