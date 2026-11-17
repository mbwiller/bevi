// SPIKE S1/S2. Temporary: remove once the iPhone test is done.
//
// The camera view is a web-only DOM island (SpikeOverlay.web.tsx). This is what every other
// platform, and jest's default (native) resolution, gets instead: nothing.

import type { SpikeOverlayProps } from './types';

export function SpikeOverlay(_props: SpikeOverlayProps) {
  return null;
}
