// SPIKE S1/S2. Temporary: remove once the iPhone test is done.

/**
 * How the camera view meets the top of the screen. Only a real iPhone can pick one (plan R6):
 * - `clearance`: full-bleed, controls pushed down by Bevi's inset context (inset + StatusBarClearance). The plan's proposal.
 * - `env`: full-bleed, controls pushed down by CSS `env(safe-area-inset-top)` only, as bev-maps does. Expected to fail.
 * - `below-strip`: the view starts under `#edge-strip`, leaving the strip in sight so iOS 26 keeps its hard top edge.
 */
export type TopEdgeMode = 'clearance' | 'env' | 'below-strip';

export interface SpikeOverlayProps {
  stream: MediaStream | null;
  topEdge: TopEdgeMode;
  /** The top inset from SafeAreaInsetsContext, which already includes StatusBarClearance's extra. */
  contextTop: number;
  /** Last GPS accuracy in metres, or null before the first fix. */
  accuracyM: number | null;
  /** ×: end the trip. */
  onExit: () => void;
  /** The camera track ended (iOS can end it in the background). */
  onCameraLost: () => void;
}
