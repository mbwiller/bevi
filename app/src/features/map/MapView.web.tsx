import type { VenuePin } from '@bevi/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useVenuesInView } from '@/api/hooks';
import type { MapViewport } from '@/api/venueViewport';
import { Skeleton } from '@/components/Skeleton';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { useReducedTransparency } from '@/lib/glass';
import { size, spacing, useTheme } from '@/theme';

import { attributionCss } from './attribution';
import { mapConfig, type MapConfig } from './config';
import { attach, detach, getMapSession, getMapStatus, loadMap, subscribeMapStatus, type MapSession } from './googleMaps';
import { interactionOptions, toLatLngBounds, VIEWPORT_DEBOUNCE_MS } from './mapOptions';
import { MapNotice, noticeFor } from './MapNotice';
import { MapPlaceholder } from './MapPlaceholder';
import type { MapViewProps } from './MapView';
import { pinHtml, pinLabel, pinSignature, pinZIndex } from './pinContent';
import { reconcileMarkers, type Entry } from './reconcile';
import { VenueCard } from './VenueCard';

export type { MapViewProps } from './MapView';

/**
 * The Search tab's live New York City map (M-16 part 1, decisions 34–37): the session's one Google
 * map (googleMaps.ts) borrowed into this host, venue pins from `venues.inView` for the settled
 * viewport, and a card for the tapped pin. With no key, a failed load or a rejected key it is the
 * placeholder, never Google's grey box.
 */
export function MapView(props: MapViewProps) {
  return <MapViewWith config={mapConfig} {...props} />;
}

/** `MapView` with its config passed in, so tests can give it one. */
export function MapViewWith({ config, passive, filters }: MapViewProps & { config: MapConfig }) {
  const status = useSyncExternalStore(subscribeMapStatus, getMapStatus, getMapStatus);
  if (!config.ok) return <MapPlaceholder reason="no-key" />;
  if (status === 'failed') return <MapPlaceholder />;
  return <LiveMap config={config} passive={passive} filters={filters} />;
}

interface Marker {
  el: google.maps.marker.AdvancedMarkerElement;
  content: HTMLDivElement;
}

function LiveMap({ config, passive, filters }: MapViewProps & { config: Extract<MapConfig, { ok: true }> }) {
  const { colors, scheme, elevation } = useTheme();
  const reduced = useReducedMotion();
  const reducedTransparency = useReducedTransparency();
  const hostRef = useRef<View>(null);
  const [session, setSession] = useState<MapSession | null>(getMapSession);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const markers = useRef(new Map<string, Entry<Marker>>());
  const pinsById = useRef(new Map<string, VenuePin>());

  // Borrow the session's map div (created on the first mount, re-parented on later ones), and load
  // the API and the map the first time.
  useEffect(() => {
    // react-native-web: a View's ref is its DOM node.
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host) return;
    attach(host);
    let live = true;
    loadMap(config).then(
      (s) => live && setSession(s),
      () => {}, // the status store says `failed` and MapViewWith shows the placeholder
    );
    return () => {
      live = false;
      detach(host);
    };
  }, [config]);

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

  const settled = useDebouncedValue(viewport, VIEWPORT_DEBOUNCE_MS);
  const pins = useVenuesInView(settled, filters);

  // Passive while the search panel covers the map: no gestures, no keys, nothing focusable.
  useEffect(() => {
    if (!session) return;
    session.map.setOptions(interactionOptions(passive));
    session.map.getDiv().inert = passive;
  }, [session, passive]);

  useEffect(() => {
    if (session) session.attribution.style.cssText = attributionCss(colors, reducedTransparency);
  }, [session, colors, reducedTransparency]);

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
        el.addEventListener('gmp-click', () => setSelected(pinsById.current.get(id) ?? null));
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
  }, [session, pins.data, selectedId, colors, elevation.floating, reduced, scheme]);

  // This host's markers go with it; the next host (or a remount) rebuilds them from the cache.
  useEffect(() => {
    const own = markers.current;
    return () => {
      for (const { marker } of own.values()) marker.el.map = null;
      own.clear();
    };
  }, []);

  // The card follows the venue's latest data while it is in view, and keeps the last copy otherwise.
  const card = selected ? (pins.data?.find((p) => p.venue.id === selected.venue.id) ?? selected) : null;
  const notice = noticeFor({
    isError: pins.isError,
    error: pins.error,
    data: pins.data,
    isFetching: pins.isFetching,
    isPlaceholderData: pins.isPlaceholderData,
    fetchStatus: pins.fetchStatus,
  });

  return (
    <View style={styles.fill}>
      <View ref={hostRef} testID="map-host" style={[styles.fill, { backgroundColor: colors.input }]} />
      {session ? null : (
        <View style={StyleSheet.absoluteFill} accessible accessibilityLabel="Loading map" aria-busy>
          <Skeleton variant="block" style={styles.skeleton} />
        </View>
      )}
      {notice && !passive ? (
        <View style={styles.top} pointerEvents="box-none">
          <MapNotice notice={notice} onRetry={() => void pins.refetch()} />
        </View>
      ) : null}
      {card && !passive ? <VenueCard pin={card} onClose={() => setSelected(null)} style={styles.card} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  skeleton: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, height: '100%', borderRadius: 0 },
  top: { position: 'absolute', top: spacing.md, left: spacing.gutter, right: spacing.gutter, alignItems: 'center' },
  // Clear of Google's logo and the OpenStreetMap credit above it, which must stay visible.
  card: { position: 'absolute', left: spacing.gutter, right: spacing.gutter, bottom: size.target + spacing.lg },
});
