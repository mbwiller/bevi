import { create } from 'zustand';

import type { CaptureMark } from './types';

/**
 * Lets a screenshot be taken of the app without the reporter in it (iOS). The window screenshot
 * (`captureScreen`, capture.ts) photographs everything in the key window, and the reporter's layer
 * (ReportLayer.tsx) is in it, so the layer is hidden first and shown again straight after the
 * shutter. The web needs none of this: it leaves `[data-report-ui]` out of its redraw.
 *
 * `hideReporterLayer` resolves once the layer has said it is drawn hidden and two frames have
 * passed (the hidden state has to reach the screen before the shutter, not only the React tree).
 *
 * The same moment is how a selection gets into the picture. The web draws its numbered outlines on
 * a canvas; a window screenshot has no canvas, so while the reporter is hidden the layer shows the
 * outlines (`marks`) instead, and the shutter photographs them with the app.
 */

export const useLayerHidden = create<{ hidden: boolean; marks: readonly CaptureMark[] }>(() => ({ hidden: false, marks: [] }));

/** How long to wait for the layer to say it is hidden, so a layer that went away never stalls a capture. */
const ACK_TIMEOUT_MS = 500;
/** Frames to let the screen draw the hidden layer before the shutter. */
const SETTLE_FRAMES = 2;
/** The longest the layer stays hidden, whatever the capture does: a shutter that never answers must not leave the reporter invisible. */
const MAX_HIDDEN_MS = 3000;

let mounted = 0;
let holds = 0;
let committed: (() => void) | null = null;
let ready: Promise<void> | null = null;

/** The layer calls this while it is mounted; the returned function is its unmount. */
export function registerLayer(): () => void {
  mounted += 1;
  return () => {
    mounted -= 1;
  };
}

/** The layer calls this from an effect once it has rendered hidden. */
export function layerIsHidden(): void {
  const done = committed;
  committed = null;
  done?.();
}

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

/**
 * Hides the reporter's layer and resolves with the function that shows it again (safe to call
 * twice). With no layer mounted it does nothing, so a capture with nothing to hide is not delayed.
 * `marks` are drawn in the reporter's place for as long as it is hidden; of two captures that
 * overlap, the first one's marks are the ones shown.
 */
export async function hideReporterLayer(marks: readonly CaptureMark[] = []): Promise<() => void> {
  if (mounted === 0) return () => {};
  holds += 1;
  let released = false;
  let failsafe: ReturnType<typeof setTimeout> | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    clearTimeout(failsafe);
    holds -= 1;
    if (holds === 0) {
      ready = null;
      committed = null;
      useLayerHidden.setState({ hidden: false, marks: [] });
    }
  };
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      committed = resolve;
    });
    useLayerHidden.setState({ hidden: true, marks });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ACK_TIMEOUT_MS);
  });
  failsafe = setTimeout(release, MAX_HIDDEN_MS);
  try {
    await Promise.race([ready, timeout]);
    await frames(SETTLE_FRAMES);
  } finally {
    clearTimeout(timer);
  }
  return release;
}
