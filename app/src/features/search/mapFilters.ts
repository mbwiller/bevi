// Parked 2026-11-11 (TASKS.md D-16, M-32): unmounted, kept for the Bev Maps integration.
// The Search tab map's filters (M-16, §1c), owned by the Search feature. They outlive the screen
// (a tab switch, a Bev page and back) and last for the browser session: kept in sessionStorage, so a
// reload in the same tab keeps them and a new tab starts clean. Nothing here is sent anywhere but
// `venues.inView`.

import type { VenueFilters } from '@bevi/shared';
import { create } from 'zustand';

import { activeFilterCount, sanitiseFilters } from '@/features/map/filters';

export const MAP_FILTERS_KEY = 'bevi.search.mapFilters';

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): SessionStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // Storage can throw when the browser blocks it (private modes, sandboxed frames).
    return null;
  }
}

function read(): VenueFilters {
  try {
    const raw = store()?.getItem(MAP_FILTERS_KEY);
    return raw ? sanitiseFilters(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function write(filters: VenueFilters): void {
  try {
    const s = store();
    if (!s) return;
    if (activeFilterCount(filters) === 0) s.removeItem(MAP_FILTERS_KEY);
    else s.setItem(MAP_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Full or blocked storage: the filters still hold for this page.
  }
}

export interface MapFiltersState {
  filters: VenueFilters;
  setFilters: (filters: VenueFilters) => void;
  reset: () => void;
}

export const useMapFilters = create<MapFiltersState>((set) => ({
  filters: read(),
  setFilters: (next) => {
    const filters = sanitiseFilters(next);
    write(filters);
    set({ filters });
  },
  reset: () => {
    write({});
    set({ filters: {} });
  },
}));

/** Tests only: re-read storage, as a page load would. */
export function reloadMapFiltersForTests(): void {
  useMapFilters.setState({ filters: read() });
}
