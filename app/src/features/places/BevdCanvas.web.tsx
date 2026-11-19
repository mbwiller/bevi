import type { BevdPin } from '@bevi/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { attributionCss } from '@/features/map/attribution';
import { mapConfig, type MapConfig } from '@/features/map/config';
import { attach, detach, getMapStatus, loadMap, subscribeMapStatus, type MapSession } from '@/features/map/googleMaps';
import { useTheme } from '@/theme';

import type { BevdCanvasProps } from './BevdCanvas';
import { BevdPlaceList } from './BevdPlaceList';
import { FIT_MAX_ZOOM, FIT_PADDING, SINGLE_PIN_ZOOM, pinBounds, pinCss, pinLabel, pinSignature, pinText, pinZIndex } from './bevdPin';
import { MAP_UNAVAILABLE_NOTE } from './copy';

export type { BevdCanvasProps } from './BevdCanvas';

interface Marker {
  el: google.maps.marker.AdvancedMarkerElement;
  content: HTMLDivElement;
  signature: string;
}

/** The world, not the five boroughs the venue map was held to: a Bev can be had anywhere. */
const WORLD_MIN_ZOOM = 2;

/**
 * The Map tab on the web (BEV-22): the session's one Google map (features/map/googleMaps.ts, which
 * creates it at most once, since each creation is billed) with a pin for every place a Bev was had.
 *
 * With no key, a failed load or a rejected key it is the same places as a list, never Google's grey
 * box: the screen works without the map.
 */
export function BevdCanvas(props: BevdCanvasProps) {
  return <BevdCanvasWith config={mapConfig} {...props} />;
}

/** `BevdCanvas` with its config passed in, so tests can give it one. */
export function BevdCanvasWith({ config, ...props }: BevdCanvasProps & { config: MapConfig }) {
  const status = useSyncExternalStore(subscribeMapStatus, getMapStatus, getMapStatus);
  if (!config.ok || status === 'failed') {
    return (
      <BevdPlaceList
        pins={props.pins}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        note={config.ok ? MAP_UNAVAILABLE_NOTE : undefined}
      />
    );
  }
  return <BevdLiveMap config={config} {...props} />;
}

function BevdLiveMap({ config, pins, selectedId, onSelect, onClear }: BevdCanvasProps & { config: Extract<MapConfig, { ok: true }> }) {
  const { colors, scheme } = useTheme();
  const reduced = useReducedMotion();
  const [session, setSession] = useState<MapSession | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Stable, or React would call it with null and the node again on every render. On the web a
  // react-native-web View's ref is its DOM element.
  const onHost = useCallback((v: View | null) => setHost(v as unknown as HTMLElement | null), []);
  const markers = useRef(new Map<string, Marker>());
  // Markers keep their click handler for life, so it reads the latest callbacks through these.
  const select = useRef(onSelect);
  select.current = onSelect;
  const clear = useRef(onClear);
  clear.current = onClear;

  // Load the API and create the map the first time (later mounts get the same session).
  useEffect(() => {
    let current = true;
    loadMap(config).then(
      (s) => current && setSession(s),
      () => {}, // the status store says `failed` and BevdCanvasWith shows the list
    );
    return () => {
      current = false;
    };
  }, [config]);

  // Borrow the map's div into this screen's host for as long as it is mounted.
  useEffect(() => {
    if (!host) return;
    attach(host);
    return () => detach(host);
  }, [host]);

  // The session's map was configured for the venue map: New York only. This one is of the world.
  useEffect(() => {
    if (!session) return;
    session.map.setOptions({ restriction: null, minZoom: WORLD_MIN_ZOOM });
    session.attribution.style.cssText = attributionCss(colors);
    const click = session.map.addListener('click', () => clear.current());
    return () => click.remove();
  }, [session, colors]);

  // Markers, kept in step with the pins by venue id. Moving the map's div between hosts takes
  // Google's markers off the map, so this also re-runs (and re-adds them) when the host changes.
  useEffect(() => {
    if (!session || !host) return;
    const seen = new Set<string>();
    for (const pin of pins) {
      const id = pin.venue.id;
      seen.add(id);
      const selected = id === selectedId;
      const signature = pinSignature(pin, { selected, reduced, scheme });
      let m = markers.current.get(id);
      if (!m) {
        const content = document.createElement('div');
        const el = new session.marker.AdvancedMarkerElement({ content, gmpClickable: true });
        el.addEventListener('gmp-click', () => select.current(id));
        m = { el, content, signature: '' };
        markers.current.set(id, m);
      }
      if (m.signature !== signature) {
        m.content.style.cssText = pinCss(pin, { colors, selected, reduced });
        m.content.textContent = pinText(pin);
        m.el.position = { lat: pin.venue.lat, lng: pin.venue.lng };
        m.el.title = pinLabel(pin);
        m.el.zIndex = pinZIndex(pin, selected);
        m.signature = signature;
      }
      if (m.el.map !== session.map) m.el.map = session.map;
    }
    for (const [id, m] of markers.current) {
      if (seen.has(id)) continue;
      m.el.map = null;
      markers.current.delete(id);
    }
  }, [session, host, pins, selectedId, colors, reduced, scheme]);

  // This component's markers go with it; a remount rebuilds them.
  useEffect(() => {
    const own = markers.current;
    return () => {
      for (const m of own.values()) m.el.map = null;
      own.clear();
    };
  }, []);

  // The camera: fitted to the pins when the set of places changes (first load, another scope), and
  // moved to a pin when one is selected. Panning by hand in between is left alone.
  const fitted = useRef('');
  useEffect(() => {
    if (!session || !host) return;
    const key = pins.map((p) => p.venue.id).sort().join(',');
    if (key === fitted.current) return;
    fitted.current = key;
    const box = pinBounds(pins);
    if (!box) return;
    if (pins.length === 1) {
      session.map.setCenter({ lat: box.south, lng: box.west });
      session.map.setZoom(SINGLE_PIN_ZOOM);
      return;
    }
    session.map.fitBounds(box, FIT_PADDING);
    // fitBounds on two shops a block apart would zoom to a rooftop; pull back once it settles.
    const once = session.map.addListener('idle', () => {
      once.remove();
      if ((session.map.getZoom() ?? 0) > FIT_MAX_ZOOM) session.map.setZoom(FIT_MAX_ZOOM);
    });
    return () => once.remove();
  }, [session, host, pins]);

  useEffect(() => {
    if (!session || !selectedId) return;
    const pin = pins.find((p) => p.venue.id === selectedId);
    if (!pin) return;
    session.map.panTo({ lat: pin.venue.lat, lng: pin.venue.lng });
    if ((session.map.getZoom() ?? 0) < SINGLE_PIN_ZOOM - 2) session.map.setZoom(SINGLE_PIN_ZOOM);
    // On the selection only: a refetch of the same pins must not yank the camera back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedId]);

  return (
    <View ref={onHost} style={[styles.fill, { backgroundColor: colors.input }]} testID="bevd-map" />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
