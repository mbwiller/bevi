// The map's pure pieces (M-16 part 1): config, Google options, pin markup and marker reconciling.

import { NYC_BOUNDS, type VenuePin } from '@bevi/shared';

import { colors, elevation, motion } from '@/theme';

import { attributionCss, OSM_ATTRIBUTION } from '../attribution';
import { DEMO_MAP_ID, readMapConfig } from '../config';
import { DEFAULT_CENTER, interactionOptions, mapOptions, toLatLngBounds } from '../mapOptions';
import { noticeFor } from '../MapNotice';
import { iconSvg, locationDotHtml, NO_SCORE, pinHtml, pinLabel, pinScore, pinSignature, pinZIndex, SELECTED_LIFT, SELECTED_SCALE, SELECTED_Z } from '../pinContent';
import { reconcileMarkers, type Entry } from '../reconcile';

const light = colors.light;
const dark = colors.dark;

function pin(id: string, over: Partial<VenuePin> = {}, venue: Partial<VenuePin['venue']> = {}): VenuePin {
  return {
    venue: {
      id,
      name: `Venue ${id}`,
      kind: 'craft',
      lat: 40.7762,
      lng: -73.9495,
      address: null,
      neighborhood: null,
      borough: 'Manhattan',
      hoursOsm: null,
      hoursKnown: false,
      website: null,
      ...venue,
    },
    bestScore: 8.24,
    predictedScore: null,
    openNow: null,
    bevCount: 3,
    ...over,
  };
}

describe('readMapConfig', () => {
  it('needs a key; trims both values', () => {
    expect(readMapConfig(undefined, 'x')).toEqual({ ok: false, problem: 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set.' });
    expect(readMapConfig('   ', 'x').ok).toBe(false);
    expect(readMapConfig(' k ', ' id ')).toEqual({ ok: true, key: 'k', mapId: 'id', demoMapId: false });
  });

  it("falls back to Google's demo Map ID (localhost only) without one", () => {
    expect(readMapConfig('k', undefined)).toEqual({ ok: true, key: 'k', mapId: DEMO_MAP_ID, demoMapId: true });
    expect(readMapConfig('k', ' ')).toMatchObject({ mapId: 'DEMO_MAP_ID', demoMapId: true });
  });
});

describe('map options', () => {
  it('opens on the Upper East Side inside NYC_BOUNDS, with Roosevelt Island beside it', () => {
    const o = mapOptions('m');
    expect(o.center).toEqual(DEFAULT_CENTER);
    // Roosevelt Island's middle is a few hundred metres from the opening centre.
    expect(Math.abs(DEFAULT_CENTER.lng - -73.95)).toBeLessThan(0.01);
    expect(DEFAULT_CENTER.lat).toBeGreaterThan(NYC_BOUNDS.south);
    expect(DEFAULT_CENTER.lat).toBeLessThan(NYC_BOUNDS.north);
    expect(o.restriction).toEqual({ latLngBounds: { ...NYC_BOUNDS }, strictBounds: true });
    expect(o).toMatchObject({ minZoom: 10, maxZoom: 19, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy' });
  });

  it('is passive under the search panel: no gestures, no keys', () => {
    expect(interactionOptions(true)).toEqual({ gestureHandling: 'none', keyboardShortcuts: false });
    expect(interactionOptions(false)).toEqual({ gestureHandling: 'greedy', keyboardShortcuts: true });
  });

  it("converts Google's bounds literal", () => {
    expect(toLatLngBounds({ north: 2, south: 1, east: 4, west: 3 })).toEqual({ south: 1, west: 3, north: 2, east: 4 });
  });

  it('credits OpenStreetMap legibly in both themes', () => {
    expect(OSM_ATTRIBUTION).toBe('© OpenStreetMap contributors');
    expect(attributionCss(light)).toContain(`background:${light.glassFill}`);
    expect(attributionCss(dark, true)).toContain(`background:${dark.surface}`);
    expect(attributionCss(dark)).toContain(`color:${dark.text}`);
  });
});

describe('noticeFor', () => {
  const q = { isError: false, error: null, data: undefined, isFetching: false, isPlaceholderData: false };

  it('offline (paused, nothing cached) is a network notice; paused with pins up says nothing', () => {
    const n = noticeFor({ ...q, fetchStatus: 'paused' });
    expect(n?.kind).toBe('error');
    expect(n && n.kind === 'error' && (n.error as { code?: string }).code).toBe('network');
    expect(noticeFor({ ...q, fetchStatus: 'paused', data: [1] })).toBeNull();
  });

  it('an empty settled result is "no spots"; loading is silent', () => {
    expect(noticeFor({ ...q, data: [], fetchStatus: 'idle' })).toEqual({ kind: 'empty' });
    expect(noticeFor({ ...q, fetchStatus: 'fetching', isFetching: true })).toBeNull();
  });
});

describe('pin content', () => {
  const look = { colors: light, floating: elevation.light.floating, selected: false, reduced: false };

  it('shows the best Bayesian score, or the predicted one with a dotted ring and "~" when there is none', () => {
    expect(pinScore(pin('a'))).toEqual({ value: 8.24, predicted: false });
    expect(pinScore(pin('a', { predictedScore: 7.06 }))).toEqual({ value: 8.24, predicted: false });
    expect(pinScore(pin('a', { bestScore: null, predictedScore: 7.06 }))).toEqual({ value: 7.06, predicted: true });
    expect(pinScore(pin('a', { bestScore: null }))).toEqual({ value: null, predicted: false });

    const best = pinHtml(pin('a'), look);
    expect(best).toContain('>8.2</span>');
    expect(best).not.toContain('dotted');

    const predicted = pinHtml(pin('a', { bestScore: null, predictedScore: 7.06 }), look);
    expect(predicted).toContain('>~7.1</span>');
    expect(predicted).toContain(`outline:2px dotted ${light.textSecondary}`);
  });

  it('a white callout with a grape circle and the kind glyph, in theme colours', () => {
    const html = pinHtml(pin('a'), look);
    expect(html).toContain(`background:${light.surface}`);
    expect(html).toContain(`background:${light.primary}`);
    expect(html).toContain(`stroke="${light.onPrimary}"`);
    expect(html).toContain(`color:${light.text}`);
    expect(html).toContain(elevation.light.floating);
    // At least a 44pt target.
    expect(html).toContain('min-width:44px;min-height:44px');

    const night = pinHtml(pin('a'), { ...look, colors: dark, floating: elevation.dark.floating });
    expect(night).toContain(`background:${dark.surface}`);
    expect(night).toContain(`background:${dark.primary}`);

    // Chain and craft draw different glyphs.
    expect(pinHtml(pin('a', {}, { kind: 'chain' }), look)).not.toBe(html);
  });

  it('no score yet: the glyph and "–" in textSecondary (MapCallout)', () => {
    const html = pinHtml(pin('a', { bestScore: null }), look);
    expect(html).not.toMatch(/\d\.\d<\/span>/);
    expect(html).toContain(`color:${light.textSecondary};white-space:nowrap">${NO_SCORE}</span>`);
    expect(pinLabel(pin('a', { bestScore: null }))).toBe('Venue a, craft, no score yet');
  });

  it('holds no venue text, so nothing from the data is parsed as HTML', () => {
    const html = pinHtml(pin('a', {}, { name: '<img src=x onerror=alert(1)>' }), look);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('the selected pin is raised and grows; Reduce Motion drops the transition', () => {
    const selected = pinHtml(pin('a'), { ...look, selected: true });
    expect(selected).toContain(`transform:translateY(-${SELECTED_LIFT}px) scale(${SELECTED_SCALE})`);
    expect(pinHtml(pin('a'), look)).not.toContain('transform:translateY');
    expect(selected).toContain(`border:1px solid ${light.primary}`);
    expect(selected).toContain(`transition:transform ${motion.fast}ms`);
    expect(pinHtml(pin('a'), { ...look, selected: true, reduced: true })).not.toContain('transition');
    expect(pinZIndex(pin('a'), true)).toBe(SELECTED_Z);
    expect(pinZIndex(pin('a', { bestScore: 9.1 }), false)).toBeGreaterThan(pinZIndex(pin('b', { bestScore: 6 }), false));
    expect(pinZIndex(pin('a', { bestScore: 10 }), false)).toBeLessThan(SELECTED_Z);
    expect(pinZIndex(pin('a', { bestScore: null }), false)).toBe(0);
  });

  it('labels the marker for screen readers', () => {
    expect(pinLabel(pin('a'))).toBe('Venue a, craft, score 8.2');
    expect(pinLabel(pin('a', { bestScore: null, predictedScore: 7 }, { kind: 'chain' }))).toBe('Venue a, chain, predicted score 7.0');
  });

  it('its signature changes only with what it draws', () => {
    const base = { selected: false, reduced: false, scheme: 'light' };
    const sig = pinSignature(pin('a'), base);
    expect(pinSignature(pin('a', { openNow: true, bevCount: 9 }), base)).toBe(sig);
    expect(pinSignature(pin('a', { bestScore: 9 }), base)).not.toBe(sig);
    expect(pinSignature(pin('a'), { ...base, selected: true })).not.toBe(sig);
    expect(pinSignature(pin('a'), { ...base, scheme: 'dark' })).not.toBe(sig);
  });

  it('the blue dot: fizz on a surface ring, with no data in it', () => {
    const dot = locationDotHtml(light, elevation.light.floating);
    expect(dot).toContain(`background:${light.fizz}`);
    expect(dot).toContain(`border:3px solid ${light.surface}`);
    expect(dot).toContain('aria-hidden="true"');
    expect(locationDotHtml(dark, elevation.dark.floating)).toContain(`background:${dark.fizz}`);
  });

  it('renders a Lucide icon as SVG markup', () => {
    const svg = iconSvg({ node: [['path', { d: 'M1 1h2', key: 'k1' }], ['circle', { cx: 12, cy: 12, r: 3, key: 'k2' }]] }, '#fff', 16, 2);
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1h2"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    );
  });
});

describe('reconcileMarkers', () => {
  function run(markers: Map<string, Entry<string>>, pins: VenuePin[]) {
    const log: string[] = [];
    const counts = reconcileMarkers(markers, pins, {
      signature: (p) => `${p.bestScore}`,
      create: (p) => {
        log.push(`create ${p.venue.id}`);
        return `m-${p.venue.id}`;
      },
      update: (m, p) => void log.push(`update ${m} ${p.bestScore}`),
      remove: (m) => void log.push(`remove ${m}`),
    });
    return { counts, log };
  }

  it('adds, updates and removes by venue id, leaving unchanged markers alone', () => {
    const markers = new Map<string, Entry<string>>();
    expect(run(markers, [pin('a'), pin('b')]).log).toEqual(['create a', 'create b']);

    const next = run(markers, [pin('b', { bestScore: 9 }), pin('a'), pin('c')]);
    expect(next.log).toEqual(['update m-b 9', 'create c']);
    expect(next.counts).toEqual({ added: 1, updated: 1, removed: 0 });

    const last = run(markers, [pin('c')]);
    expect(last.log).toEqual(['remove m-a', 'remove m-b']);
    expect([...markers.keys()]).toEqual(['c']);
    expect(run(markers, [pin('c')]).log).toEqual([]);
  });
});
