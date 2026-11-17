// The one Google map of the session (M-16, decision 34). Web only: imported by MapView.web.tsx,
// never by a screen under jest (MapView.tsx stands in there; its own test mocks the loader).
//
// Every `new google.maps.Map` is a billable Dynamic Maps load against a 10,000-a-month free cap,
// so the map is created at most once per app session, lazily, the first time the Search tab's map
// mounts, on a `div` this module owns. Hosts (the inline map under the search bar now, a
// full-screen host in part 2) borrow that div with `attach` / `detach`, which re-parent it: the
// Bev Maps `minimap/maps.ts` pattern. Leaving the tab, or unmounting the host, never destroys it.

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

import { OSM_ATTRIBUTION } from './attribution';
import type { MapConfig } from './config';
import { mapOptions } from './mapOptions';

export type MapStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface MapSession {
  map: google.maps.Map;
  marker: google.maps.MarkerLibrary;
  /** The "© OpenStreetMap contributors" control; hosts style it for the current theme. */
  attribution: HTMLDivElement;
}

interface State {
  status: MapStatus;
  element: HTMLDivElement | null;
  host: HTMLElement | null;
  loading: Promise<MapSession> | null;
  session: MapSession | null;
  /** How many times `new google.maps.Map` ran: the billable number, asserted in a test. */
  created: number;
}

const fresh = (): State => ({ status: 'idle', element: null, host: null, loading: null, session: null, created: 0 });
let state = fresh();
const listeners = new Set<() => void>();

function setStatus(status: MapStatus) {
  if (state.status === status) return;
  state.status = status;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore`. */
export function subscribeMapStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getMapStatus(): MapStatus {
  return state.status;
}

export function getMapSession(): MapSession | null {
  return state.session;
}

/** How many Maps were created this session (0 or 1). */
export function mapsCreated(): number {
  return state.created;
}

/**
 * The map's own `div`, created once. Absolutely filled to its host (a react-native-web View, which is
 * `position: relative`), so it never depends on percentage heights inside flex layouts.
 */
function ensureElement(): HTMLDivElement {
  if (!state.element) {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.inset = '0';
    state.element = el;
  }
  return state.element;
}

/**
 * Google calls a global `gm_authFailure` when the key is rejected (wrong referrer, API not enabled,
 * billing or quota) after the map has drawn its grey "can't load Google Maps" box. Turn that into
 * `failed`, so the host shows the placeholder instead.
 */
function installAuthFailureHook() {
  const w = window as unknown as { gm_authFailure?: () => void };
  const previous = w.gm_authFailure;
  w.gm_authFailure = () => {
    setStatus('failed');
    state.element?.remove();
    previous?.();
  };
}

/**
 * Loads the Maps JS API (once) and creates the session's map (once). Later calls return the same
 * promise, whatever the outcome: a failed script load stays failed until the page reloads, which
 * is also what Google's loader does.
 */
export function loadMap(config: Extract<MapConfig, { ok: true }>): Promise<MapSession> {
  if (state.loading) return state.loading;
  setStatus('loading');
  installAuthFailureHook();
  setOptions({ key: config.key, v: 'weekly', mapIds: [config.mapId] });
  state.loading = Promise.all([importLibrary('core'), importLibrary('maps'), importLibrary('marker')]).then(
    ([core, maps, marker]) => {
      if (state.status === 'failed') throw new Error('Google Maps rejected the key.');
      const map = new maps.Map(ensureElement(), mapOptions(config.mapId));
      state.created += 1;
      const attribution = document.createElement('div');
      attribution.textContent = OSM_ATTRIBUTION;
      map.controls[core.ControlPosition.LEFT_BOTTOM]?.push(attribution);
      state.session = { map, marker, attribution };
      setStatus('ready');
      return state.session;
    },
    (error: unknown) => {
      setStatus('failed');
      throw error;
    },
  );
  // Callers that only want the status don't have to handle the rejection.
  state.loading.catch(() => {});
  return state.loading;
}

/** Moves the map's `div` into `host` (it leaves any previous host). */
export function attach(host: HTMLElement): void {
  const el = ensureElement();
  if (el.parentElement !== host) host.appendChild(el);
  state.host = host;
}

/**
 * Takes the map's `div` out of `host`. A no-op when another host has borrowed it since, so an
 * inline host unmounting after the full-screen host attached cannot steal the map back.
 */
export function detach(host: HTMLElement): void {
  if (state.host !== host) return;
  state.element?.remove();
  state.host = null;
}

/** Tests only: forget the session (the real one lives as long as the page). */
export function resetMapSessionForTests(): void {
  state.element?.remove();
  state = fresh();
  listeners.clear();
}
