import type { VenueFilters, VenuePin } from '@bevi/shared';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useMe, useVenueNeighborhoods, useVenuesInView } from '@/api/hooks';
import type { MapViewport } from '@/api/venueViewport';
import { MapControls, type MapMode } from '@/components/MapControls';
import { Skeleton } from '@/components/Skeleton';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { useReducedTransparency } from '@/lib/glass';
import { spacing, useTheme } from '@/theme';

import { attributionCss } from './attribution';
import { mapConfig, type MapConfig } from './config';
import { usableFilters } from './filters';
import { attach, detach, getMapSession, getMapStatus, loadMap, subscribeMapStatus, type MapSession } from './googleMaps';
import { browserGeolocation, locate, LOCATE_COPY, LOCATE_ZOOM, type LatLng } from './locate';
import { MapFilters } from './MapFilters';
import { interactionOptions, toLatLngBounds, VIEWPORT_DEBOUNCE_MS } from './mapOptions';
import { MapNotice, noticeFor, type Notice } from './MapNotice';
import { MapPlaceholder } from './MapPlaceholder';
import type { MapViewProps } from './MapView';
import { locationDotHtml, pinHtml, pinLabel, pinSignature, pinZIndex, SELECTED_Z } from './pinContent';
import { reconcileMarkers, type Entry } from './reconcile';
import { VenueList } from './VenueList';
import { VenuePanel } from './VenuePanel';

export type { MapViewProps } from './MapView';

const NO_FILTERS: VenueFilters = {};
const NO_NEIGHBORHOODS: readonly string[] = [];
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
/** The VenueSheet's share of the window: the Sheet's 40% snap. */
export const VENUE_SHEET_SHARE = 0.4;
/** How long a locate notice ("You're outside New York City") stays up. */
export const INFO_MS = 4_000;

/**
 * The Search tab's live New York City map (M-16, decisions 34–37): the session's one Google map
 * (googleMaps.ts), venue pins from `venues.inView` for the settled viewport, and Beli's chrome. With
 * no key, a failed load or a rejected key it is the placeholder, never Google's grey box.
 */
export function MapView(props: MapViewProps) {
  return <MapViewWith config={mapConfig} {...props} />;
}

/** `MapView` with its config passed in, so tests can give it one. */
export function MapViewWith({ config, ...props }: MapViewProps & { config: MapConfig }) {
  const status = useSyncExternalStore(subscribeMapStatus, getMapStatus, getMapStatus);
  if (!config.ok) return <MapPlaceholder reason="no-key" />;
  if (status === 'failed') return <MapPlaceholder />;
  return <LiveMap config={config} {...props} />;
}

interface Marker {
  el: google.maps.marker.AdvancedMarkerElement;
  content: HTMLDivElement;
}

/** react-native-web: a View's ref is its DOM node. */
const asElement = (v: View | null) => v as unknown as HTMLElement | null;

/**
 * Two hosts, one map (§1c "Inline vs full screen"). Inline, under the search bar, the map pans in
 * place with the filter row and `View List`. A pin, `View List` or "open the full map" opens the same
 * map full screen in a Modal (which traps focus and closes on Escape on the web) with the full chrome,
 * the List view and the docked VenueSheet. The map's `div` is re-parented between the two hosts with
 * the loader's `attach` / `detach`, so its viewport carries across and no second Map is ever created;
 * closing hands it back to the inline host.
 */
function LiveMap({
  config,
  passive,
  filters = NO_FILTERS,
  onFiltersChange,
  active = true,
}: MapViewProps & { config: Extract<MapConfig, { ok: true }> }) {
  const { colors, scheme, elevation } = useTheme();
  const reduced = useReducedMotion();
  const reducedTransparency = useReducedTransparency();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
  const [session, setSession] = useState<MapSession | null>(getMapSession);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<MapMode>('map');
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);
  const [fullHost, setFullHost] = useState<HTMLElement | null>(null);
  const [inlineTop, setInlineTop] = useState(0);
  const [fullTop, setFullTop] = useState(0);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const markers = useRef(new Map<string, Entry<Marker>>());
  const pinsById = useRef(new Map<string, VenuePin>());
  const pendingCenter = useRef<LatLng | null>(null);
  const live = useRef(true);
  const locatingNow = useRef(false);

  // The full-screen map shows while it is open, the Search tab is on display and the panel is down.
  const shown = full && active && !passive;
  const host = shown && fullHost ? fullHost : inlineHost;
  const onInlineHost = useCallback((v: View | null) => setInlineHost(asElement(v)), []);
  const onFullHost = useCallback((v: View | null) => setFullHost(asElement(v)), []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Load the API and create the map the first time (later mounts get the same session).
  useEffect(() => {
    let current = true;
    loadMap(config).then(
      (s) => current && setSession(s),
      () => {}, // the status store says `failed` and MapViewWith shows the placeholder
    );
    return () => {
      current = false;
    };
  }, [config]);

  // Borrow the map's div into whichever host is showing. Switching hosts detaches the old one first;
  // closing the full screen re-attaches the inline host.
  useEffect(() => {
    if (!host) return;
    attach(host);
    return () => detach(host);
  }, [host]);

  // The viewport, read on every `idle` (after a pan or zoom settles), and a tap on the map clears
  // the selected pin.
  useEffect(() => {
    if (!session) return;
    const { map } = session;
    const read = () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (bounds && zoom != null) setViewport({ bounds: toLatLngBounds(bounds.toJSON()), zoom });
    };
    read();
    const idle = map.addListener('idle', read);
    const click = map.addListener('click', () => setSelected(null));
    return () => {
      idle.remove();
      click.remove();
    };
  }, [session]);

  // The filters this viewer can use feed the pins (and the pills show them).
  const me = useMe();
  const canSeeAlcohol = me.data?.canSeeAlcohol ?? false;
  const hoods = useVenueNeighborhoods();
  const vocabulary = hoods.data ?? (hoods.isError ? NO_NEIGHBORHOODS : undefined);
  const usable = useMemo(() => usableFilters(filters, canSeeAlcohol, vocabulary), [filters, canSeeAlcohol, vocabulary]);
  const changeFilters = useCallback((f: VenueFilters) => onFiltersChange?.(f), [onFiltersChange]);

  const settled = useDebouncedValue(viewport, VIEWPORT_DEBOUNCE_MS);
  const pins = useVenuesInView(settled, usable);

  // No gestures, keys or focus while the search panel covers the map, or the List view covers it.
  const still = passive || (shown && mode === 'list');
  useEffect(() => {
    if (!session) return;
    session.map.setOptions(interactionOptions(still));
    session.map.getDiv().inert = still;
  }, [session, still]);

  useEffect(() => {
    if (session) session.attribution.style.cssText = attributionCss(colors, reducedTransparency);
  }, [session, colors, reducedTransparency]);

  const openFull = useCallback((m: MapMode) => {
    setMode(m);
    setFull(true);
  }, []);
  const closeFull = useCallback(() => {
    setFull(false);
    setSelected(null);
    setMode('map');
  }, []);
  // The panel coming up (a link focusing the bar) closes the full-screen map.
  useEffect(() => {
    if (passive) closeFull();
  }, [passive, closeFull]);

  const move = useCallback(
    (p: LatLng) => {
      const map = session?.map;
      if (!map) return;
      if (reduced) map.setCenter(p);
      else map.panTo(p);
    },
    [session, reduced],
  );

  // A pin tap selects its venue (opening the full screen from inline).
  const selectPin = useCallback((pin: VenuePin) => {
    setSelected(pin);
    setMode('map');
    setFull(true);
  }, []);

  // A List row: back to the map, centred on the venue, its VenueSheet open.
  const showOnMap = useCallback(
    (pin: VenuePin) => {
      const p = { lat: pin.venue.lat, lng: pin.venue.lng };
      pendingCenter.current = p;
      setSelected(pin);
      setMode('map');
      move(p);
    },
    [move],
  );

  // The full-screen map resized (the VenueSheet docked or left): centre on a List pick, or bring the
  // selected pin back into view if the sheet now covers where it was.
  const onFullLayout = useCallback(() => {
    const map = session?.map;
    if (!map) return;
    const p = pendingCenter.current;
    pendingCenter.current = null;
    const target = p ?? (selected ? { lat: selected.venue.lat, lng: selected.venue.lng } : null);
    if (!target) return;
    const bounds = map.getBounds() as (google.maps.LatLngBounds & { contains?: unknown }) | undefined;
    if (!p && bounds && typeof bounds.contains === 'function' && bounds.contains(target)) return;
    const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0);
    later(() => move(target));
  }, [session, selected, move]);

  // Markers, reconciled by venue id on every answer (and when the selection or theme changes).
  const selectedId = selected?.venue.id ?? null;
  useEffect(() => {
    if (!session) return;
    const data = pins.data ?? [];
    pinsById.current = new Map(data.map((p) => [p.venue.id, p]));
    const isSelected = (pin: VenuePin) => pin.venue.id === selectedId;
    const look = (pin: VenuePin) => ({ colors, floating: elevation.floating, selected: isSelected(pin), reduced });
    const paint = (m: Marker, pin: VenuePin) => {
      m.content.innerHTML = pinHtml(pin, look(pin));
      m.el.position = { lat: pin.venue.lat, lng: pin.venue.lng };
      m.el.title = pinLabel(pin);
      m.el.zIndex = pinZIndex(pin, isSelected(pin));
    };
    reconcileMarkers(markers.current, data, {
      signature: (pin) =>
        `${pin.venue.lat},${pin.venue.lng}|${pinLabel(pin)}|` +
        pinSignature(pin, { selected: isSelected(pin), reduced, scheme }),
      create: (pin) => {
        const content = document.createElement('div');
        const el = new session.marker.AdvancedMarkerElement({ content, gmpClickable: true });
        const id = pin.venue.id;
        el.addEventListener('gmp-click', () => {
          const p = pinsById.current.get(id);
          if (p) selectPin(p);
        });
        const m = { el, content };
        paint(m, pin);
        el.map = session.map;
        return m;
      },
      update: paint,
      remove: (m) => {
        m.el.map = null;
      },
    });
  }, [session, pins.data, selectedId, colors, elevation.floating, reduced, scheme, selectPin]);

  // This component's markers go with it; a remount rebuilds them from the cache.
  useEffect(() => {
    const own = markers.current;
    return () => {
      for (const { marker } of own.values()) marker.el.map = null;
      own.clear();
    };
  }, []);

  // The blue dot: placed only after a tap on locate, never sent anywhere.
  const dot = useRef<Marker | null>(null);
  useEffect(() => {
    if (!session || !here) return;
    if (!dot.current) {
      const content = document.createElement('div');
      const el = new session.marker.AdvancedMarkerElement({ content, title: 'You are here', zIndex: SELECTED_Z + 1 });
      dot.current = { el, content };
    }
    dot.current.content.innerHTML = locationDotHtml(colors, elevation.floating);
    dot.current.el.position = here;
    dot.current.el.map = session.map;
  }, [session, here, colors, elevation.floating]);
  useEffect(
    () => () => {
      if (dot.current) dot.current.el.map = null;
    },
    [],
  );

  const onLocate = useCallback(async () => {
    if (locatingNow.current) return;
    locatingNow.current = true;
    setLocating(true);
    const r = await locate(browserGeolocation());
    locatingNow.current = false;
    if (!live.current) return;
    setLocating(false);
    if (r.kind !== 'inside') {
      setInfo(LOCATE_COPY[r.kind]);
      return;
    }
    setInfo(null);
    setHere(r.position);
    move(r.position);
    const map = session?.map;
    const zoom = map?.getZoom();
    if (map && (zoom == null || zoom < LOCATE_ZOOM)) map.setZoom(LOCATE_ZOOM);
  }, [move, session]);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), INFO_MS);
    return () => clearTimeout(t);
  }, [info]);

  // The sheet follows the venue's latest data while it is in view, and keeps the last copy otherwise.
  const current = selected ? (pins.data?.find((p) => p.venue.id === selected.venue.id) ?? selected) : null;
  const pinsNotice = noticeFor({
    isError: pins.isError,
    error: pins.error,
    data: pins.data,
    isFetching: pins.isFetching,
    isPlaceholderData: pins.isPlaceholderData,
    fetchStatus: pins.fetchStatus,
  });
  const fullNotice: Notice = info ? { kind: 'info', text: info } : pinsNotice;
  const loading = session ? null : (
    <View style={StyleSheet.absoluteFill} accessible accessibilityLabel="Loading map" aria-busy>
      <Skeleton variant="block" style={styles.skeleton} />
    </View>
  );

  const inlineChrome = !passive && !shown;
  return (
    <View style={styles.fill}>
      <View ref={onInlineHost} testID="map-host" style={[styles.fill, { backgroundColor: colors.input }]} />
      {loading}
      {inlineChrome ? (
        <MapControls onExpand={() => openFull('map')} onViewList={() => openFull('list')} onTopHeight={setInlineTop}>
          <MapFilters filters={usable} onChange={changeFilters} canSeeAlcohol={canSeeAlcohol} neighborhoods={vocabulary ?? NO_NEIGHBORHOODS} />
        </MapControls>
      ) : null}
      {pinsNotice && inlineChrome ? (
        <View style={[styles.notice, { top: inlineTop + spacing.xs }]} pointerEvents="box-none">
          <MapNotice notice={pinsNotice} onRetry={() => void pins.refetch()} />
        </View>
      ) : null}

      <Modal
        visible={shown}
        transparent
        animationType={reduced ? 'none' : 'fade'}
        // Escape (web) or back: the VenueSheet first, then the full screen.
        onRequestClose={() => (selected ? setSelected(null) : closeFull())}
        {...({ 'aria-label': 'Map' } as object)}
      >
        <View testID="map-full" style={[styles.fill, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
          <View style={styles.fill}>
            <View ref={onFullHost} testID="map-host-full" style={[styles.fill, { backgroundColor: colors.input }]} onLayout={onFullLayout} />
            {loading}
            {mode === 'list' ? (
              <VenueList pins={pins} onSelect={showOnMap} style={[StyleSheet.absoluteFill, { paddingTop: fullTop }]} />
            ) : null}
            <MapControls
              expanded
              mode={mode}
              onModeChange={setMode}
              onClose={closeFull}
              onLocate={() => void onLocate()}
              located={!!here}
              locating={locating}
              onViewList={() => setMode('list')}
              onTopHeight={setFullTop}
            >
              <MapFilters filters={usable} onChange={changeFilters} canSeeAlcohol={canSeeAlcohol} neighborhoods={vocabulary ?? NO_NEIGHBORHOODS} />
            </MapControls>
            {fullNotice && mode === 'map' ? (
              <View style={[styles.notice, { top: fullTop + spacing.xs }]} pointerEvents="box-none">
                <MapNotice notice={fullNotice} onRetry={() => void pins.refetch()} />
              </View>
            ) : null}
          </View>
          {current && mode === 'map' ? (
            <VenuePanel
              pin={current}
              onClose={() => setSelected(null)}
              style={{ height: Math.round(windowHeight * VENUE_SHEET_SHARE) + insets.bottom, paddingBottom: insets.bottom }}
            />
          ) : (
            <View style={{ height: insets.bottom }} />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  skeleton: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, height: '100%', borderRadius: 0 },
  notice: { position: 'absolute', left: spacing.gutter, right: spacing.gutter, alignItems: 'center' },
});
