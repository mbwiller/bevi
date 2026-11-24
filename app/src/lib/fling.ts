/**
 * What something dragged does when the finger lets go: where it is headed, and how it gets there.
 * Shared by the Sheet and the image viewer so both answer a release the same way. Every function is
 * a worklet: a gesture calls them on the UI thread.
 */

/**
 * The share of its speed something sliding keeps each millisecond: UIScrollView's normal
 * deceleration rate, the one a list coasts with after a flick.
 */
export const DECELERATION = 0.998;

/**
 * How far past the release point a release at `velocity` (pt/s) would coast before it stopped. A
 * release is judged by where it was going, not by where the finger happened to lift: a short quick
 * flick goes as far as a long slow drag (Apple's projection, "Designing Fluid Interfaces", WWDC 2018).
 */
export function project(velocity: number): number {
  'worklet';
  // Read here, not as a default parameter: a worklet only carries what its body names.
  return ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** The rest point nearest to `at`. `points` must not be empty. */
export function nearest(at: number, points: readonly number[]): number {
  'worklet';
  let best = points[0]!;
  for (const p of points) if (Math.abs(p - at) < Math.abs(best - at)) best = p;
  return best;
}

/** The rest point a release at `at` with `velocity` (pt/s) settles on: the one nearest to where it would coast. */
export function restAfter(at: number, velocity: number, points: readonly number[]): number {
  'worklet';
  return nearest(at + project(velocity), points);
}

/**
 * The spring that carries a released sheet or picture to its rest point, started at the finger's
 * own speed (`settle`). Critically damped: it arrives without wobbling, in about a third of a second.
 */
export const SETTLE = { mass: 1, stiffness: 300, damping: 35 } as const;

/** `SETTLE` carrying on at `velocity` (pt/s), so the movement never changes speed as the finger lifts. */
export function settle(velocity: number) {
  'worklet';
  return { mass: SETTLE.mass, stiffness: SETTLE.stiffness, damping: SETTLE.damping, velocity };
}

/** Pulled past where it can go, something follows the finger at this rate: it gives a little, it doesn't come away. */
export const RUBBER = 0.15;
