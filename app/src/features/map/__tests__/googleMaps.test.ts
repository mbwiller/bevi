/**
 * @jest-environment jsdom
 */
// The session's one Google map (M-16 DoD: "map never created more than once per session"). The
// loader is mocked, so nothing here reaches Google.

import { NYC_BOUNDS } from '@bevi/shared';

const mockMapCtor = jest.fn();
const mockPush = jest.fn();
let mockFail: Error | null = null;
const mockSetOptions = jest.fn();

jest.mock('@googlemaps/js-api-loader', () => ({
  setOptions: (o: unknown) => mockSetOptions(o),
  importLibrary: async (name: string) => {
    if (mockFail) throw mockFail;
    if (name === 'core') return { ControlPosition: { LEFT_BOTTOM: 6 } };
    if (name === 'maps') {
      return {
        Map: class {
          controls: { push: (el: HTMLElement) => void }[] = [];
          constructor(div: HTMLElement, opts: unknown) {
            mockMapCtor(div, opts);
            this.controls[6] = { push: mockPush };
          }
        },
      };
    }
    return { AdvancedMarkerElement: class {} };
  },
}));

import { attach, detach, getMapStatus, loadMap, mapsCreated, resetMapSessionForTests } from '../googleMaps';

const config = { ok: true as const, key: 'browser-key', mapId: 'bevi-map', demoMapId: false };

beforeEach(() => {
  resetMapSessionForTests();
  mockMapCtor.mockClear();
  mockPush.mockClear();
  mockSetOptions.mockClear();
  mockFail = null;
  delete (window as { gm_authFailure?: unknown }).gm_authFailure;
});

const host = () => document.body.appendChild(document.createElement('div'));

describe('the session map', () => {
  it('is created exactly once across mount, unmount and remount, and re-parented between hosts', async () => {
    expect(mapsCreated()).toBe(0);
    expect(getMapStatus()).toBe('idle');

    // First mount: borrow the div, load.
    const inline = host();
    attach(inline);
    const first = await loadMap(config);
    expect(getMapStatus()).toBe('ready');
    const div = inline.firstElementChild;
    expect(div).toBeTruthy();
    expect(mockMapCtor).toHaveBeenCalledWith(div, expect.anything());

    // Unmount, then remount in the same place.
    detach(inline);
    expect(inline.childElementCount).toBe(0);
    attach(inline);
    expect(await loadMap(config)).toBe(first);

    // A second host (part 2's full screen) borrows the very same div.
    const full = host();
    attach(full);
    expect(full.firstElementChild).toBe(div);
    expect(inline.childElementCount).toBe(0);
    // The inline host unmounting late cannot take it back.
    detach(inline);
    expect(full.firstElementChild).toBe(div);
    detach(full);
    expect(full.childElementCount).toBe(0);
    attach(inline);
    await loadMap(config);

    expect(mockMapCtor).toHaveBeenCalledTimes(1);
    expect(mapsCreated()).toBe(1);
    expect(mockSetOptions).toHaveBeenCalledTimes(1);
    expect(mockSetOptions).toHaveBeenCalledWith({ key: 'browser-key', v: 'weekly', mapIds: ['bevi-map'] });
  });

  it('two hosts loading at once still make one map', async () => {
    attach(host());
    const [a, b] = await Promise.all([loadMap(config), loadMap(config)]);
    expect(a).toBe(b);
    expect(mapsCreated()).toBe(1);
  });

  it('borrowing the div loads nothing: only loadMap (the first map mount) touches Google', () => {
    attach(host());
    expect(mockSetOptions).not.toHaveBeenCalled();
    expect(mapsCreated()).toBe(0);
    expect(getMapStatus()).toBe('idle');
  });

  it('is NYC-only with no Google UI, and carries the OpenStreetMap credit', async () => {
    attach(host());
    const { attribution } = await loadMap(config);
    const opts = mockMapCtor.mock.calls[0]![1];
    expect(opts).toMatchObject({
      mapId: 'bevi-map',
      restriction: { latLngBounds: { ...NYC_BOUNDS }, strictBounds: true },
      minZoom: 10,
      maxZoom: 19,
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    });
    expect(mockPush).toHaveBeenCalledWith(attribution);
    expect(attribution.textContent).toBe('© OpenStreetMap contributors');
  });

  it('a loader failure is `failed`, and stays failed without loading again', async () => {
    mockFail = new Error('script failed');
    attach(host());
    await expect(loadMap(config)).rejects.toThrow('script failed');
    expect(getMapStatus()).toBe('failed');
    await expect(loadMap(config)).rejects.toThrow('script failed');
    expect(mockSetOptions).toHaveBeenCalledTimes(1);
    expect(mapsCreated()).toBe(0);
  });

  it("Google's auth failure (bad key, referrer, quota) is `failed` and takes the grey box away", async () => {
    const h = host();
    attach(h);
    await loadMap(config);
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();
    expect(getMapStatus()).toBe('failed');
    expect(h.childElementCount).toBe(0);
  });
});
