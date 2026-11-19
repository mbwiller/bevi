/**
 * @jest-environment jsdom
 */
// The Map tab's web surface (BEV-22) over a stand-in for the session's Google map: a marker per
// place, kept in step with the pins, the camera, selection, and the list it falls back to when the
// map cannot load. jsdom only for `document.createElement` (marker content).

import type { BevdPin } from '@bevi/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { BevdCanvasWith } from '../BevdCanvas.web';
import { FIT_PADDING, PIN, PIN_SELECTED, SELECTED_Z, SINGLE_PIN_ZOOM } from '../bevdPin';
import { MAP_UNAVAILABLE_NOTE } from '../copy';

// FlashList's own jest setup, for the fallback list.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => ({
  ...jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout'),
  measureParentSize: () => ({ x: 0, y: 0, width: 400, height: 900 }),
  measureFirstChildLayout: () => ({ x: 0, y: 0, width: 400, height: 900 }),
  measureItemLayout: () => ({ x: 0, y: 0, width: 100, height: 100 }),
}));

type Listener = () => void;

/** A stand-in for google.maps.Map and AdvancedMarkerElement, enough for the canvas. */
function fakeSession() {
  const listeners: Record<string, Listener[]> = {};
  const markers: FakeMarker[] = [];
  class FakeMarker {
    map: unknown = null;
    title = '';
    zIndex: number | null = null;
    position: { lat: number; lng: number } | null = null;
    content: HTMLElement;
    handlers: Listener[] = [];
    constructor(o: { content: HTMLElement }) {
      this.content = o.content;
      markers.push(this);
    }
    addEventListener(_type: string, handler: Listener) {
      this.handlers.push(handler);
    }
  }
  let zoom = 13.75;
  const map = {
    setOptions: jest.fn(),
    getZoom: () => zoom,
    setZoom: jest.fn((z: number) => void (zoom = z)),
    setCenter: jest.fn(),
    panTo: jest.fn(),
    fitBounds: jest.fn(),
    addListener: (name: string, l: Listener) => {
      (listeners[name] ??= []).push(l);
      return { remove: () => void (listeners[name] = (listeners[name] ?? []).filter((x) => x !== l)) };
    },
  };
  return {
    session: { map, marker: { AdvancedMarkerElement: FakeMarker }, attribution: { style: { cssText: '' } } },
    map,
    markers,
    live: () => markers.filter((m) => m.map === map),
    pin: (name: string) => markers.find((m) => m.map === map && m.title.startsWith(name))!,
    emit: (name: string) => [...(listeners[name] ?? [])].forEach((l) => l()),
    zoomTo: (z: number) => void (zoom = z),
  };
}

let fake: ReturnType<typeof fakeSession>;
const mock = {
  status: 'idle',
  listeners: new Set<() => void>(),
  attach: jest.fn(),
  detach: jest.fn(),
  loadMap: jest.fn(),
};
jest.mock('@/features/map/googleMaps', () => ({
  attach: (h: unknown) => mock.attach(h),
  detach: (h: unknown) => mock.detach(h),
  loadMap: (c: unknown) => mock.loadMap(c),
  getMapStatus: () => mock.status,
  subscribeMapStatus: (l: () => void) => {
    mock.listeners.add(l);
    return () => mock.listeners.delete(l);
  },
}));

const CONFIG = { ok: true as const, key: 'k', mapId: 'm', demoMapId: false };

const pin = (id: string, name: string, lat: number, lng: number, bevCount = 1, mineCount = 1): BevdPin => ({
  venue: { id, name, kind: 'craft', lat, lng, address: null, neighborhood: null, borough: null, hoursOsm: null, hoursKnown: false, website: null },
  bevCount,
  mineCount,
  latestAt: '2026-11-19T12:00:00Z',
});
const DUANE = pin('v1', 'Duane Reade', 40.7616, -73.9497, 3, 1);
const CAFE = pin('v2', 'The Café at Cornell Tech', 40.7557, -73.956, 1, 0);
const PUB = pin('v3', 'The Long Hall', 53.3419, -6.2643);

beforeEach(() => {
  fake = fakeSession();
  mock.status = 'idle';
  mock.listeners.clear();
  mock.attach.mockClear();
  mock.detach.mockClear();
  mock.loadMap.mockReset();
  mock.loadMap.mockImplementation(async () => fake.session);
});

function canvas(pins: BevdPin[], selectedId: string | null = null, handlers: { onSelect?: jest.Mock; onClear?: jest.Mock } = {}) {
  return (
    <BevdCanvasWith
      config={CONFIG}
      pins={pins}
      selectedId={selectedId}
      onSelect={handlers.onSelect ?? jest.fn()}
      onClear={handlers.onClear ?? jest.fn()}
    />
  );
}

it('draws a marker per place, labelled, and lifts the map out of New York', async () => {
  await render(canvas([DUANE, CAFE]));
  await waitFor(() => expect(fake.live()).toHaveLength(2));

  expect(mock.attach).toHaveBeenCalledTimes(1);
  expect(fake.map.setOptions).toHaveBeenCalledWith({ restriction: null, minZoom: 2 });

  const duane = fake.pin('Duane Reade');
  expect(duane.title).toBe('Duane Reade, 3 Bevs, 1 yours');
  expect(duane.content.textContent).toBe('3');
  expect(duane.position).toEqual({ lat: 40.7616, lng: -73.9497 });
  expect(duane.content.style.width).toBe(`${PIN}px`);
  expect(fake.pin('The Café').title).toBe('The Café at Cornell Tech, 1 Bev, from people you follow');
});

it('fits the camera to the pins, once, and again only when the set of places changes', async () => {
  const view = await render(canvas([DUANE, CAFE]));
  await waitFor(() => expect(fake.map.fitBounds).toHaveBeenCalledTimes(1));
  expect(fake.map.fitBounds).toHaveBeenCalledWith({ south: 40.7557, west: -73.956, north: 40.7616, east: -73.9497 }, FIT_PADDING);

  // The same places with new counts (a refetch): the camera is left where the user put it.
  await view.rerender(canvas([{ ...DUANE, bevCount: 4 }, CAFE]));
  await waitFor(() => expect(fake.pin('Duane Reade').content.textContent).toBe('4'));
  expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);

  // A place in Dublin joins: fitted again, now across the ocean.
  await view.rerender(canvas([DUANE, CAFE, PUB]));
  await waitFor(() => expect(fake.map.fitBounds).toHaveBeenCalledTimes(2));
  expect(fake.live()).toHaveLength(3);
});

it('a fit that lands too close pulls back, and one place is centred at street level instead', async () => {
  const view = await render(canvas([DUANE, CAFE]));
  await waitFor(() => expect(fake.map.fitBounds).toHaveBeenCalled());
  fake.zoomTo(19);
  await act(async () => fake.emit('idle'));
  expect(fake.map.setZoom).toHaveBeenCalledWith(16);

  await view.rerender(canvas([PUB]));
  await waitFor(() => expect(fake.map.setCenter).toHaveBeenCalledWith({ lat: 53.3419, lng: -6.2643 }));
  expect(fake.map.setZoom).toHaveBeenLastCalledWith(SINGLE_PIN_ZOOM);
});

it('a marker selects its place; the selected one grows, goes on top and is panned to', async () => {
  const onSelect = jest.fn();
  const view = await render(canvas([DUANE, CAFE], null, { onSelect }));
  await waitFor(() => expect(fake.live()).toHaveLength(2));

  await act(async () => fake.pin('Duane Reade').handlers.forEach((h) => h()));
  expect(onSelect).toHaveBeenCalledWith('v1');

  await view.rerender(canvas([DUANE, CAFE], 'v1', { onSelect }));
  await waitFor(() => expect(fake.pin('Duane Reade').content.style.width).toBe(`${PIN_SELECTED}px`));
  expect(fake.pin('Duane Reade').zIndex).toBe(SELECTED_Z);
  expect(fake.map.panTo).toHaveBeenCalledWith({ lat: 40.7616, lng: -73.9497 });
  // One marker per place still: selecting repaints, it does not re-create.
  expect(fake.markers).toHaveLength(2);
});

it('a tap on the map itself clears the selection', async () => {
  const onClear = jest.fn();
  await render(canvas([DUANE], 'v1', { onClear }));
  await waitFor(() => expect(fake.live()).toHaveLength(1));
  await act(async () => fake.emit('click'));
  expect(onClear).toHaveBeenCalledTimes(1);
});

it('a place that leaves the pins loses its marker, and unmounting returns the map', async () => {
  const view = await render(canvas([DUANE, CAFE]));
  await waitFor(() => expect(fake.live()).toHaveLength(2));
  await view.rerender(canvas([CAFE]));
  await waitFor(() => expect(fake.live()).toHaveLength(1));
  expect(fake.live()[0]!.title).toMatch(/^The Café/);

  await view.unmount();
  expect(fake.live()).toHaveLength(0);
  expect(mock.detach).toHaveBeenCalledTimes(1);
});

it('with no key it is the places as a list, and Google is never loaded', async () => {
  const onSelect = jest.fn();
  await render(
    <BevdCanvasWith config={{ ok: false, problem: 'no key' }} pins={[DUANE, CAFE]} selectedId={null} onSelect={onSelect} onClear={jest.fn()} />,
  );
  await fireEvent.press(await screen.findByRole('button', { name: /^Duane Reade, 3 Bevs · 1 yours/ }));
  expect(onSelect).toHaveBeenCalledWith('v1');
  expect(mock.loadMap).not.toHaveBeenCalled();
  // No key is this build's normal state, not a fault: no apology above the list.
  expect(screen.queryByText(MAP_UNAVAILABLE_NOTE)).toBeNull();
});

it('when Google rejects the key it falls back to the list and says why', async () => {
  await render(canvas([DUANE, CAFE]));
  await waitFor(() => expect(fake.live()).toHaveLength(2));

  mock.status = 'failed';
  await act(async () => mock.listeners.forEach((l) => l()));

  expect(await screen.findByText(MAP_UNAVAILABLE_NOTE)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^The Café at Cornell Tech, 1 Bev/ })).toBeTruthy();
  expect(screen.queryByTestId('bevd-map')).toBeNull();
});
