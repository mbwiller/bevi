/**
 * @jest-environment jsdom
 */
// The web map's hosts (M-16 parts 1 and 2), with the session singleton replaced by a fake map: the
// fallbacks, passive under the search panel, pins from `venues.inView` (the FakeApi's Upper East
// Side venues), inline vs full screen on one map, the VenueSheet, the filters, the List view and
// locate. jsdom only for `document.createElement` (marker content); rendering is still React Native's.

import { ApiError, type VenueFilters } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';

import { api } from '@/api/client';
import { VENUE_GONE } from '@/components/VenueSheet';
import { controls } from '@/testing/fakeApi';

import { LOCATE_COPY, LOCATE_ZOOM } from '../locate';
import { MAP_COMING_SOON, MAP_UNAVAILABLE } from '../MapPlaceholder';
import { VIEWPORT_DEBOUNCE_MS } from '../mapOptions';
import { MapViewWith } from '../MapView.web';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

configure({ asyncUtilTimeout: VIEWPORT_DEBOUNCE_MS + 4000 });

type Listener = () => void;

/** A stand-in for google.maps.Map and AdvancedMarkerElement, enough for the hosts. */
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
    constructor(o: { content: HTMLElement; title?: string; zIndex?: number }) {
      this.content = o.content;
      this.title = o.title ?? '';
      this.zIndex = o.zIndex ?? null;
      markers.push(this);
    }
    addEventListener(_t: string, h: Listener) {
      this.handlers.push(h);
    }
  }
  let zoom = 13.75;
  const map = {
    setOptions: jest.fn(),
    getDiv: () => div,
    // The Upper East Side and Roosevelt Island, as the opening view reports it.
    getBounds: () => ({ toJSON: () => ({ south: 40.755, west: -73.975, north: 40.79, east: -73.93 }) }),
    getZoom: () => zoom,
    setZoom: jest.fn((z: number) => void (zoom = z)),
    panTo: jest.fn(),
    setCenter: jest.fn(),
    addListener: (name: string, l: Listener) => {
      (listeners[name] ??= []).push(l);
      return { remove: () => (listeners[name] = listeners[name]!.filter((x) => x !== l)) };
    },
  };
  return {
    session: { map, marker: { AdvancedMarkerElement: FakeMarker }, attribution: { style: { cssText: '' } } },
    div,
    markers,
    live: () => markers.filter((m) => m.map === map && m.title !== 'You are here'),
    pin: (name: string) => markers.find((m) => m.map === map && m.title.startsWith(name))!,
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
  mockPush.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

interface Props {
  passive?: boolean;
  filters?: VenueFilters;
  onFiltersChange?: (f: VenueFilters) => void;
  active?: boolean;
}
const ui = ({ passive = false, ...rest }: Props = {}): ReactElement => (
  <QueryClientProvider client={client}>
    <MapViewWith config={config} passive={passive} {...rest} />
  </QueryClientProvider>
);

/** Renders the map and lets the load, the debounce and `venues.inView` settle. */
async function renderMap(props: Props = {}) {
  const utils = await render(ui(props));
  await waitFor(() => expect(mock.loadMap).toHaveBeenCalled());
  await waitFor(() => expect(fake.live().length).toBeGreaterThan(0));
  return utils;
}

const tap = async (name: string) => act(async () => fake.pin(name).handlers.forEach((h) => h()));
const lastAttached = () => mock.attach.mock.calls.at(-1)![0];
const sheet = () => within(screen.getByTestId('venue-sheet'));

describe('fallbacks', () => {
  it('no key: the "coming soon" placeholder, and Google is never loaded', async () => {
    await render(
      <QueryClientProvider client={client}>
        <MapViewWith config={{ ok: false, problem: 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set.' }} passive={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(MAP_COMING_SOON)).toBeTruthy();
    expect(screen.queryByText(MAP_UNAVAILABLE)).toBeNull();
    expect(screen.queryByLabelText('View List')).toBeNull();
    expect(mock.attach).not.toHaveBeenCalled();
    expect(mock.loadMap).not.toHaveBeenCalled();
  });

  it('a failed load or a rejected key: the placeholder instead of the map', async () => {
    mock.loadMap.mockImplementation(async () => {
      setStatus('failed');
      throw new Error('nope');
    });
    await render(ui());
    expect(await screen.findByText(MAP_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByTestId('map-host')).toBeNull();
    // Whatever it borrowed, it gave back.
    expect(mock.detach.mock.calls.map((c) => c[0])).toEqual(mock.attach.mock.calls.map((c) => c[0]));
  });
});

describe('the inline map', () => {
  it('loading: a skeleton over the map area until the session map is ready', async () => {
    mock.loadMap.mockImplementation(() => new Promise(() => {}));
    await render(ui());
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

  it('shows the filter row, "open the full map" and View List, and no full-screen chrome', async () => {
    await renderMap();
    expect(screen.getByLabelText('Map filters')).toBeTruthy();
    expect(screen.getByLabelText('Open the full map')).toBeTruthy();
    expect(screen.getByLabelText('View List')).toBeTruthy();
    expect(screen.queryByLabelText('Close map')).toBeNull();
    expect(screen.queryByLabelText('Show where I am')).toBeNull();
  });

  it('is passive while the search panel is up, with no chrome over it', async () => {
    const { rerender } = await renderMap();
    expect(fake.session.map.setOptions).toHaveBeenLastCalledWith({ gestureHandling: 'greedy', keyboardShortcuts: true });
    expect(fake.div.inert).toBe(false);
    await rerender(ui({ passive: true }));
    expect(fake.session.map.setOptions).toHaveBeenLastCalledWith({ gestureHandling: 'none', keyboardShortcuts: false });
    expect(fake.div.inert).toBe(true);
    expect(screen.queryByLabelText('View List')).toBeNull();
  });

  it('a pan reconciles markers instead of rebuilding them', async () => {
    await renderMap();
    const before = [...fake.markers];
    const real = api.venues.inView.bind(api.venues);
    jest.spyOn(api.venues, 'inView').mockImplementation(async (p) => (await real(p)).filter((x) => x.venue.id !== 'venue-6'));
    fake.session.map.getZoom = () => 15.2;
    await act(async () => fake.emit('idle'));
    await waitFor(() => expect(fake.live()).toHaveLength(3));
    expect(fake.markers).toHaveLength(before.length);
    expect(fake.live().every((m) => before.includes(m))).toBe(true);
  });

  it('an offline answer says so over the map, and Retry asks again', async () => {
    controls.failNext('network', 'venues.inView');
    await render(ui());
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(fake.live().length).toBe(4));
    expect(screen.queryByTestId('map-notice')).toBeNull();
  });

  it('nothing in view: says so', async () => {
    jest.spyOn(api.venues, 'inView').mockResolvedValue([]);
    await render(ui());
    expect(await screen.findByText('No spots here yet')).toBeTruthy();
  });

  it('an under-21 viewer gets no pin for a venue whose only Bev is alcoholic', async () => {
    controls.signInAs('minor_user');
    await renderMap();
    expect(fake.live().map((m) => m.title.split(',')[0])).not.toContain('Carnegie Taproom');
  });
});

describe('inline and full screen: one map', () => {
  it('a pin opens the same map full screen; closing hands it back to the inline host, and the map is loaded once', async () => {
    await renderMap();
    const inline = mock.attach.mock.calls[0]![0];
    expect(screen.queryByTestId('map-full')).toBeNull();

    await tap('Yorkville Coffee Works');
    expect(screen.getByTestId('map-full')).toBeTruthy();
    await waitFor(() => expect(lastAttached()).not.toBe(inline));
    const full = lastAttached();
    expect(screen.getByTestId('map-host-full')).toBeTruthy();
    // The inline host gave it up first; the full screen has the whole chrome.
    expect(mock.detach).toHaveBeenCalledWith(inline);
    expect(screen.getByLabelText('Close map')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Map' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Show where I am')).toBeTruthy();
    // The tapped pin is raised, and its sheet is open.
    expect(fake.pin('Yorkville Coffee Works').content.innerHTML).toContain('data-bevi-pin="selected"');
    expect(fake.pin('Yorkville Coffee Works').zIndex).toBe(10_000);
    expect(sheet().getByText('Yorkville Coffee Works')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Close map'));
    expect(screen.queryByTestId('map-full')).toBeNull();
    expect(lastAttached()).toBe(inline);
    expect(mock.detach).toHaveBeenCalledWith(full);
    expect(fake.pin('Yorkville Coffee Works').content.innerHTML).toContain('data-bevi-pin="idle"');

    // Again, from "open the full map": the same two hosts, still one load.
    await fireEvent.press(screen.getByLabelText('Open the full map'));
    await waitFor(() => expect(lastAttached()).not.toBe(inline));
    await fireEvent.press(screen.getByLabelText('Close map'));
    expect(lastAttached()).toBe(inline);
    expect(mock.loadMap).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the VenueSheet first, then the full screen', async () => {
    await renderMap();
    await tap('Yorkville Coffee Works');
    await fireEvent(screen.getByTestId('map-full'), 'requestClose');
    expect(screen.queryByTestId('venue-sheet')).toBeNull();
    expect(screen.getByTestId('map-full')).toBeTruthy();
    await fireEvent(screen.getByTestId('map-full'), 'requestClose');
    expect(screen.queryByTestId('map-full')).toBeNull();
  });

  it('a tap on the map, or the sheet\'s close circle, clears the selection', async () => {
    await renderMap();
    await tap('Yorkville Coffee Works');
    await fireEvent.press(sheet().getByLabelText('Close'));
    expect(screen.queryByTestId('venue-sheet')).toBeNull();
    await tap('Lexington Deli');
    expect(sheet().getByText('Lexington Deli')).toBeTruthy();
    await act(async () => fake.emit('click'));
    expect(screen.queryByTestId('venue-sheet')).toBeNull();
  });

  it('steps aside while another screen is on display, and comes back as it was', async () => {
    const { rerender } = await renderMap();
    const inline = mock.attach.mock.calls[0]![0];
    await tap('Yorkville Coffee Works');
    await waitFor(() => expect(lastAttached()).not.toBe(inline));
    await rerender(ui({ active: false }));
    expect(screen.queryByTestId('map-full')).toBeNull();
    expect(lastAttached()).toBe(inline);
    await rerender(ui({ active: true }));
    expect(screen.getByTestId('map-full')).toBeTruthy();
    expect(sheet().getByText('Yorkville Coffee Works')).toBeTruthy();
    await waitFor(() => expect(lastAttached()).not.toBe(inline));
  });

  it('the search panel coming up closes the full screen', async () => {
    const { rerender } = await renderMap();
    await tap('Yorkville Coffee Works');
    await rerender(ui({ passive: true }));
    await rerender(ui({ passive: false }));
    expect(screen.queryByTestId('map-full')).toBeNull();
  });
});

describe('the VenueSheet', () => {
  it('loading: the pin fills the header and the count while the Bevs load', async () => {
    jest.spyOn(api.venues, 'get').mockImplementation(() => new Promise(() => {}));
    await renderMap();
    await tap('Yorkville Coffee Works');
    expect(sheet().getByText('Yorkville Coffee Works')).toBeTruthy();
    expect(sheet().getByText('Craft · Yorkville · Manhattan')).toBeTruthy();
    expect(sheet().getByText('Bevs here (3)')).toBeTruthy();
    expect(sheet().getByLabelText('Loading Bevs')).toBeTruthy();
  });

  it('data: kind · neighborhood · borough, open state, address, website, the Bevs and the OSM credit', async () => {
    const get = jest.spyOn(api.venues, 'get');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderMap();
    await tap('Yorkville Coffee Works');
    expect(get).toHaveBeenCalledWith('venue-1');
    await waitFor(() => expect(sheet().getAllByLabelText(/^Rank /)).toHaveLength(3));
    expect(sheet().getByText(/^(Open now|Closed)$/)).toBeTruthy();
    expect(sheet().getByText('1512 2nd Avenue')).toBeTruthy();
    expect(sheet().getByText('© OpenStreetMap contributors')).toBeTruthy();
    await fireEvent.press(sheet().getByRole('link', { name: 'Website, example.test/yorkville-coffee' }));
    expect(open).toHaveBeenCalledWith('https://example.test/yorkville-coffee');

    // Hours that couldn't be read are "unknown", never "closed".
    await tap('Lexington Deli');
    expect(sheet().getByText('Hours unknown')).toBeTruthy();
  });

  it('not_found: "This spot isn\'t here anymore"', async () => {
    jest.spyOn(api.venues, 'get').mockRejectedValue(new ApiError('not_found', 'No such venue'));
    await renderMap();
    await tap('Yorkville Coffee Works');
    expect(await sheet().findByText(VENUE_GONE)).toBeTruthy();
    expect(sheet().queryByText('Bevs here (3)')).toBeNull();
  });

  it('another failure: an ErrorState with Retry', async () => {
    jest.spyOn(api.venues, 'get').mockRejectedValueOnce(new ApiError('unknown', 'boom'));
    await renderMap();
    await tap('Yorkville Coffee Works');
    await fireEvent.press(await sheet().findByLabelText('Retry'));
    await waitFor(() => expect(sheet().getAllByLabelText(/^Rank /)).toHaveLength(3));
  });

  it('each row: your score if you ranked it, else your prediction, else the Bayesian score', async () => {
    const detail = await api.venues.get('venue-1');
    const [mine, guessed, plain] = detail.bevs;
    const realGet = api.bevs.get.bind(api.bevs);
    jest.spyOn(api.bevs, 'get').mockImplementation(async (id) => {
      const bev = await realGet(id);
      if (id === mine!.id) return { ...bev, myRanking: { bucket: 'LOVED', position: 0, bucketSize: 1, score: 9.4, note: null }, prediction: null };
      if (id === guessed!.id) return { ...bev, myRanking: null, prediction: { score: 6.3, confidence: 0.8, generatedAt: '', rankingVersion: '' } };
      return { ...bev, myRanking: null, prediction: null };
    });
    await renderMap();
    await tap('Yorkville Coffee Works');
    await waitFor(() => expect(sheet().getByText('Your score')).toBeTruthy());
    expect(sheet().getByLabelText('Score 9.4')).toBeTruthy();
    expect(sheet().getByText("You'd rate it")).toBeTruthy();
    expect(sheet().getByLabelText('Predicted score 6.3')).toBeTruthy();
    if (plain!.bayesScore != null) expect(sheet().getAllByLabelText(`Score ${plain!.bayesScore.toFixed(1)}`).length).toBeGreaterThan(0);
  });

  it('Rank it starts ranking the Bev; tapping a row opens its page', async () => {
    const { bevs } = await api.venues.get('venue-1');
    await renderMap();
    await tap('Yorkville Coffee Works');
    await waitFor(() => expect(sheet().getAllByLabelText(/^Rank /)).toHaveLength(3));
    await fireEvent.press(sheet().getByLabelText(`Rank ${bevs[0]!.name}`));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/rank/[bevId]', params: { bevId: bevs[0]!.id } });
    await fireEvent.press(sheet().getByRole('button', { name: bevs[1]!.name }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/bev/[id]', params: { id: bevs[1]!.id } });
  });
});

describe('the filters', () => {
  it('feed venues.inView in canonical form (empty means no filter)', async () => {
    const inView = jest.spyOn(api.venues, 'inView');
    await renderMap({ filters: { priceTiers: [2, 1], kinds: [], categoryIds: ['coffee'], openNow: true } });
    expect(inView).toHaveBeenCalledWith(expect.objectContaining({ filters: { categoryIds: ['coffee'], priceTiers: [1, 2], openNow: true } }));
    // The pills say what is on.
    expect(screen.getByLabelText('Filters, 3 on')).toBeTruthy();
    expect(screen.getByLabelText('Category: Coffee')).toBeTruthy();
    expect(screen.getByLabelText('Price: $, $$')).toBeTruthy();
  });

  it('never sends an alcoholic category for an under-21 viewer', async () => {
    controls.signInAs('minor_user');
    const inView = jest.spyOn(api.venues, 'inView');
    await renderMap({ filters: { categoryIds: ['beer', 'coffee'] } });
    await waitFor(() => expect(inView).toHaveBeenCalledWith(expect.objectContaining({ filters: { categoryIds: ['coffee'] } })));
    for (const [p] of inView.mock.calls) expect(p.filters?.categoryIds ?? []).not.toContain('beer');
  });

  it('Neighborhood shows with a vocabulary and is left out (with any old pick) when it is empty', async () => {
    await renderMap();
    expect(await screen.findByLabelText('Neighborhood')).toBeTruthy();
    client.clear();
    jest.spyOn(api.venues, 'neighborhoods').mockResolvedValue([]);
    const inView = jest.spyOn(api.venues, 'inView');
    await render(ui({ filters: { neighborhoods: ['Yorkville'] } }));
    await waitFor(() => expect(inView).toHaveBeenCalledWith(expect.objectContaining({ filters: {} })));
    expect(screen.queryByLabelText(/^Neighborhood/)).toBeNull();
  });

  it('Open now toggles; a ▾ pill opens a multi-select sheet; Filters N holds them all with Reset', async () => {
    const onFiltersChange = jest.fn();
    const { rerender } = await renderMap({ onFiltersChange });
    await fireEvent.press(screen.getByRole('button', { name: 'Open now' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ openNow: true });

    await fireEvent.press(screen.getByLabelText('Category'));
    await fireEvent.press(screen.getByRole('button', { name: 'Coffee' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ categoryIds: ['coffee'] });

    await rerender(ui({ onFiltersChange, filters: { categoryIds: ['coffee'], kinds: ['chain'] } }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tea' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ categoryIds: ['coffee', 'tea'], kinds: ['chain'] });
    await fireEvent.press(screen.getByRole('button', { name: 'Any category' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ categoryIds: [], kinds: ['chain'] });

    await fireEvent.press(screen.getByLabelText('Filters, 2 on'));
    await fireEvent.press(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({});
  });
});

describe('the List view', () => {
  it('View List opens the full screen on the venues in view, in inView order; a row shows it on the map', async () => {
    const order = jest.spyOn(api.venues, 'inView');
    await renderMap();
    await fireEvent.press(screen.getByLabelText('View List'));
    const list = within(screen.getByTestId('venue-list'));
    const names = (await order.mock.results.at(-1)!.value).map((p: { venue: { name: string } }) => p.venue.name);
    const rows = list.getAllByRole('button').map((b) => String(b.props.accessibilityLabel).split(',')[0]);
    expect(rows).toEqual(names);
    expect(screen.getByRole('radio', { name: 'List' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByLabelText('View List')).toBeNull();
    expect(fake.div.inert).toBe(true);

    await fireEvent.press(list.getByLabelText(/^Lexington Deli,/));
    expect(screen.queryByTestId('venue-list')).toBeNull();
    expect(sheet().getByText('Lexington Deli')).toBeTruthy();
    expect(fake.session.map.panTo).toHaveBeenCalledWith({ lat: 40.7738, lng: -73.9598 });
    expect(fake.div.inert).toBe(false);
  });

  it('nothing in view: an empty state', async () => {
    jest.spyOn(api.venues, 'inView').mockResolvedValue([]);
    await render(ui());
    await waitFor(() => expect(screen.getByText('No spots here yet')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('View List'));
    expect(within(screen.getByTestId('venue-list')).getByText('Move the map or change the filters.')).toBeTruthy();
  });
});

describe('locate', () => {
  const nav = navigator as unknown as { geolocation?: unknown };
  let getCurrentPosition: jest.Mock;
  const answer = (fn: (ok: (p: unknown) => void, fail: (e: unknown) => void) => void) =>
    getCurrentPosition.mockImplementation((ok, fail) => fn(ok, fail));

  beforeEach(() => {
    getCurrentPosition = jest.fn();
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  });
  afterEach(() => {
    delete nav.geolocation;
  });

  const openFull = async () => {
    await renderMap();
    await fireEvent.press(screen.getByLabelText('Open the full map'));
  };

  it('never asks at load', async () => {
    await openFull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('inside New York City: the blue dot, and the map pans and zooms to it', async () => {
    answer((ok) => ok({ coords: { latitude: 40.7712, longitude: -73.9561 } }));
    await openFull();
    await fireEvent.press(screen.getByLabelText('Show where I am'));
    const dot = fake.markers.find((m) => m.title === 'You are here')!;
    expect(dot.position).toEqual({ lat: 40.7712, lng: -73.9561 });
    expect(dot.map).toBe(fake.session.map);
    expect(dot.content.innerHTML).toContain('data-bevi-me');
    expect(fake.session.map.panTo).toHaveBeenCalledWith({ lat: 40.7712, lng: -73.9561 });
    expect(fake.session.map.setZoom).toHaveBeenCalledWith(LOCATE_ZOOM);
    expect(getCurrentPosition.mock.calls[0]![2]).toMatchObject({ timeout: expect.any(Number) });
  });

  it("outside New York City: a notice, and the map stays put", async () => {
    answer((ok) => ok({ coords: { latitude: 42.36, longitude: -71.06 } }));
    await openFull();
    await fireEvent.press(screen.getByLabelText('Show where I am'));
    expect(screen.getByText(LOCATE_COPY.outside)).toBeTruthy();
    expect(fake.session.map.panTo).not.toHaveBeenCalled();
    expect(fake.markers.find((m) => m.title === 'You are here')).toBeUndefined();
  });

  it('permission denied: a notice', async () => {
    answer((_ok, fail) => fail({ code: 1, message: 'denied' }));
    await openFull();
    await fireEvent.press(screen.getByLabelText('Show where I am'));
    expect(screen.getByText(LOCATE_COPY.denied)).toBeTruthy();
    expect(fake.session.map.panTo).not.toHaveBeenCalled();
  });
});
