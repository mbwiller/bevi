/**
 * @jest-environment jsdom
 */
// The web map's host (M-16 part 1), with the session singleton replaced by a fake map: the
// fallbacks, passive under the search panel, pins from `venues.inView` (the FakeApi's Upper East
// Side venues), and the card for a tapped pin. jsdom only for `document.createElement` (marker
// content); rendering is still React Native's.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';

import { MapViewWith } from '../MapView.web';
import { MAP_COMING_SOON, MAP_UNAVAILABLE } from '../MapPlaceholder';
import { VIEWPORT_DEBOUNCE_MS } from '../mapOptions';

type Listener = () => void;

/** A stand-in for google.maps.Map and AdvancedMarkerElement, enough for the host. */
function fakeSession() {
  const listeners: Record<string, Listener[]> = {};
  const div = {} as { inert?: boolean };
  const markers: FakeMarker[] = [];
  class FakeMarker {
    map: unknown = null;
    title = '';
    zIndex: number | null = null;
    position: unknown = null;
    content: HTMLElement;
    handlers: Listener[] = [];
    constructor(o: { content: HTMLElement }) {
      this.content = o.content;
      markers.push(this);
    }
    addEventListener(_t: string, h: Listener) {
      this.handlers.push(h);
    }
  }
  const map = {
    setOptions: jest.fn(),
    getDiv: () => div,
    // The Upper East Side and Roosevelt Island, as the opening view reports it.
    getBounds: () => ({ toJSON: () => ({ south: 40.755, west: -73.975, north: 40.79, east: -73.93 }) }),
    getZoom: () => 13.75,
    addListener: (name: string, l: Listener) => {
      (listeners[name] ??= []).push(l);
      return { remove: () => (listeners[name] = listeners[name]!.filter((x) => x !== l)) };
    },
  };
  return {
    session: { map, marker: { AdvancedMarkerElement: FakeMarker }, attribution: { style: { cssText: '' } } },
    div,
    markers,
    live: () => markers.filter((m) => m.map === map),
    emit: (name: string) => (listeners[name] ?? []).forEach((l) => l()),
  };
}

let fake: ReturnType<typeof fakeSession>;
const mock = {
  status: 'idle' as string,
  listeners: new Set<() => void>(),
  attach: jest.fn(),
  detach: jest.fn(),
  loadMap: jest.fn(),
};

jest.mock('../googleMaps', () => ({
  attach: (h: unknown) => mock.attach(h),
  detach: (h: unknown) => mock.detach(h),
  loadMap: (c: unknown) => mock.loadMap(c),
  getMapSession: () => null,
  getMapStatus: () => mock.status,
  subscribeMapStatus: (l: () => void) => {
    mock.listeners.add(l);
    return () => mock.listeners.delete(l);
  },
}));

const setStatus = (s: string) => {
  mock.status = s;
  mock.listeners.forEach((l) => l());
};

const config = { ok: true as const, key: 'k', mapId: 'm', demoMapId: false };
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  fake = fakeSession();
  mock.status = 'idle';
  mock.attach.mockClear();
  mock.detach.mockClear();
  mock.loadMap.mockReset();
  mock.loadMap.mockImplementation(async () => {
    setStatus('ready');
    return fake.session;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

const wrap = (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;

/** Renders the map and lets the load, the debounce and `venues.inView` settle. */
async function renderMap(passive = false) {
  const utils = await render(wrap(<MapViewWith config={config} passive={passive} />));
  await waitFor(() => expect(mock.loadMap).toHaveBeenCalled());
  await waitFor(() => expect(fake.live().length).toBeGreaterThan(0), { timeout: VIEWPORT_DEBOUNCE_MS + 2000 });
  return utils;
}

describe('fallbacks', () => {
  it('no key: the "coming soon" placeholder, and Google is never loaded', async () => {
    await render(wrap(<MapViewWith config={{ ok: false, problem: 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set.' }} passive={false} />));
    expect(screen.getByText(MAP_COMING_SOON)).toBeTruthy();
    expect(screen.queryByText(MAP_UNAVAILABLE)).toBeNull();
    expect(mock.attach).not.toHaveBeenCalled();
    expect(mock.loadMap).not.toHaveBeenCalled();
  });

  it('a failed load or a rejected key: the placeholder instead of the map', async () => {
    mock.loadMap.mockImplementation(async () => {
      setStatus('failed');
      throw new Error('nope');
    });
    await render(wrap(<MapViewWith config={config} passive={false} />));
    expect(await screen.findByText(MAP_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByTestId('map-host')).toBeNull();
    expect(mock.detach).toHaveBeenCalledTimes(1);
  });
});

describe('the live map', () => {
  it('loading: a skeleton over the map area until the session map is ready', async () => {
    mock.loadMap.mockImplementation(() => new Promise(() => {}));
    await render(wrap(<MapViewWith config={config} passive={false} />));
    expect(screen.getByLabelText('Loading map')).toBeTruthy();
    expect(screen.getByTestId('map-host')).toBeTruthy();
  });

  it('borrows the session map on mount and gives it back on unmount', async () => {
    const { unmount } = await renderMap();
    const host = mock.attach.mock.calls[0]![0];
    expect(host).toBeTruthy();
    expect(mock.loadMap).toHaveBeenCalledWith(config);
    await unmount();
    expect(mock.detach).toHaveBeenCalledWith(host);
    // Its markers leave the map with it.
    expect(fake.live()).toHaveLength(0);
  });

  it("pins the FakeApi's venues in view: hidden, empty and (for adults) the bar's", async () => {
    const inView = jest.spyOn(api.venues, 'inView');
    await renderMap();
    // Floored zoom, rounded bounds.
    expect(inView).toHaveBeenCalledWith({ bounds: { south: 40.755, west: -73.975, north: 40.79, east: -73.93 }, zoom: 13, filters: {} });
    const titles = fake.live().map((m) => m.title).sort();
    expect(titles.map((t) => t.split(',')[0])).toEqual(['Carnegie Taproom', 'Duane Reade — 86th St', 'Lexington Deli', 'Yorkville Coffee Works']);
    for (const m of fake.live()) expect(m.content.innerHTML).toContain('data-bevi-pin="idle"');
  });

  it('is passive while the search panel is up', async () => {
    const { rerender } = await renderMap();
    expect(fake.session.map.setOptions).toHaveBeenLastCalledWith({ gestureHandling: 'greedy', keyboardShortcuts: true });
    expect(fake.div.inert).toBe(false);
    await rerender(wrap(<MapViewWith config={config} passive />));
    expect(fake.session.map.setOptions).toHaveBeenLastCalledWith({ gestureHandling: 'none', keyboardShortcuts: false });
    expect(fake.div.inert).toBe(true);
  });

  it('a tapped pin is raised and gets a card; the close button or a tap on the map clears it', async () => {
    await renderMap();
    const coffee = fake.live().find((m) => m.title.startsWith('Yorkville Coffee Works'))!;
    await act(async () => coffee.handlers.forEach((h) => h()));
    expect(screen.getByText('Yorkville Coffee Works')).toBeTruthy();
    expect(screen.getByText('Craft · Yorkville')).toBeTruthy();
    expect(screen.getByText(/^(Open now|Closed now) · 3 Bevs$/)).toBeTruthy();
    expect(coffee.content.innerHTML).toContain('data-bevi-pin="selected"');
    expect(coffee.zIndex).toBe(10_000);

    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('venue-card')).toBeNull();
    expect(coffee.content.innerHTML).toContain('data-bevi-pin="idle"');

    const deli = fake.live().find((m) => m.title.startsWith('Lexington Deli'))!;
    await act(async () => deli.handlers.forEach((h) => h()));
    // Unparseable hours are "unknown", never "closed".
    expect(screen.getByText('Hours unknown · 3 Bevs')).toBeTruthy();
    await act(async () => fake.emit('click'));
    expect(screen.queryByTestId('venue-card')).toBeNull();
  });

  it('a pan reconciles markers instead of rebuilding them', async () => {
    await renderMap();
    const before = [...fake.markers];
    // A new viewport answer: the same marker objects for anything kept, removed for anything gone.
    const real = api.venues.inView.bind(api.venues);
    jest.spyOn(api.venues, 'inView').mockImplementation(async (p) => (await real(p)).filter((x) => x.venue.id !== 'venue-6'));
    fake.session.map.getZoom = () => 15.2;
    await act(async () => fake.emit('idle'));
    await waitFor(() => expect(fake.live()).toHaveLength(3), { timeout: VIEWPORT_DEBOUNCE_MS + 2000 });
    expect(fake.markers).toHaveLength(before.length);
    expect(fake.live().every((m) => before.includes(m))).toBe(true);
  });

  it('an offline answer says so over the map, and Retry asks again', async () => {
    controls.failNext('network', 'venues.inView');
    await render(wrap(<MapViewWith config={config} passive={false} />));
    expect(await screen.findByText("You're offline", undefined, { timeout: VIEWPORT_DEBOUNCE_MS + 2000 })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(fake.live().length).toBe(4));
    expect(screen.queryByTestId('map-notice')).toBeNull();
  });

  it('nothing in view: says so', async () => {
    jest.spyOn(api.venues, 'inView').mockResolvedValue([]);
    await render(wrap(<MapViewWith config={config} passive={false} />));
    expect(await screen.findByText('No spots here yet', undefined, { timeout: VIEWPORT_DEBOUNCE_MS + 2000 })).toBeTruthy();
  });

  it('an under-21 viewer gets no pin for a venue whose only Bev is alcoholic', async () => {
    controls.signInAs('minor_user');
    await renderMap();
    expect(fake.live().map((m) => m.title.split(',')[0])).not.toContain('Carnegie Taproom');
  });
});
