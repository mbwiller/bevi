import type { RefObject } from 'react';

/**
 * The native file of useWheel.web.ts: a phone has no mouse wheel, so this does nothing. The
 * PhotoCropper zooms with a pinch instead.
 */
export function useWheel(_target: RefObject<unknown>, _onWheel: (deltaY: number) => void): void {}
