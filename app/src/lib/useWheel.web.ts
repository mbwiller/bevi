import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onWheel` with the wheel's `deltaY` while the pointer is over `target` (a react-native-web
 * View, which is a DOM element), and keeps the page from scrolling under it: the listener is not
 * passive, or the browser would scroll anyway. The element can appear after the first render, so
 * each commit checks which one is there. The native file, useWheel.ts, does nothing.
 */
export function useWheel(target: RefObject<unknown>, onWheel: (deltaY: number) => void): void {
  const latest = useRef(onWheel);
  const attached = useRef<{ el: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    latest.current = onWheel;
  });
  useEffect(() => {
    const el = target.current as HTMLElement | null;
    if (attached.current?.el === el) return;
    attached.current?.off();
    attached.current = null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const listener = (e: WheelEvent) => {
      e.preventDefault();
      latest.current(e.deltaY);
    };
    el.addEventListener('wheel', listener, { passive: false });
    attached.current = { el, off: () => el.removeEventListener('wheel', listener) };
  });
  useEffect(
    () => () => {
      attached.current?.off();
      attached.current = null;
    },
    [],
  );
}
