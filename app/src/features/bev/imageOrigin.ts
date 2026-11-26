/** A frame in the window, in points. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a view sits in the window right now, or null where that cannot be read at once (jest, and
 * a view that is not laid out yet). A ref's `getBoundingClientRect` is the DOM's on the web and
 * React Native's own on iOS; both answer in window coordinates without waiting.
 */
export function windowRect(view: unknown): Rect | null {
  const node = view as { getBoundingClientRect?: () => Partial<Rect> } | null;
  if (typeof node?.getBoundingClientRect !== 'function') return null;
  const { x, y, width, height } = node.getBoundingClientRect();
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (!width || !height) return null;
  return { x: x!, y: y!, width, height };
}

let origin: Rect | null = null;

/**
 * The picture the image viewer is about to open from: call it with the tapped view just before
 * pushing `/image/[url]`, and the viewer grows out of that frame and goes back into it. Kept here
 * and not in the route's params: a frame is not part of an address, and a link or a reload has none.
 */
export function openingFrom(view: unknown): void {
  origin = windowRect(view);
}

/** The frame left by `openingFrom`, once: the next viewer to open without one starts from the centre. */
export function takeImageOrigin(): Rect | null {
  const taken = origin;
  origin = null;
  return taken;
}
