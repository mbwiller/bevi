// Keeps the map's markers in step with the latest `venues.inView` answer by venue id: new venues
// get a marker, gone ones lose theirs, and a kept one is touched only if its position or look
// changed. Rebuilding every marker on each pan would flicker and churn the DOM. Pure over an
// injected marker API, so jest tests it without Google.

import type { VenuePin } from '@bevi/shared';

export interface MarkerOps<M> {
  create(pin: VenuePin): M;
  /** Called only when `signature(pin)` differs from the marker's last one. */
  update(marker: M, pin: VenuePin): void;
  remove(marker: M): void;
  /** Everything the marker's position and look depend on. */
  signature(pin: VenuePin): string;
}

export interface Entry<M> {
  marker: M;
  signature: string;
}

/** Applies `pins` to `markers` in place; returns how many were added, updated and removed. */
export function reconcileMarkers<M>(
  markers: Map<string, Entry<M>>,
  pins: readonly VenuePin[],
  ops: MarkerOps<M>,
): { added: number; updated: number; removed: number } {
  let added = 0;
  let updated = 0;
  let removed = 0;
  const seen = new Set<string>();
  for (const pin of pins) {
    const id = pin.venue.id;
    seen.add(id);
    const signature = ops.signature(pin);
    const entry = markers.get(id);
    if (!entry) {
      markers.set(id, { marker: ops.create(pin), signature });
      added += 1;
    } else if (entry.signature !== signature) {
      ops.update(entry.marker, pin);
      entry.signature = signature;
      updated += 1;
    }
  }
  for (const [id, entry] of markers) {
    if (seen.has(id)) continue;
    ops.remove(entry.marker);
    markers.delete(id);
    removed += 1;
  }
  return { added, updated, removed };
}
