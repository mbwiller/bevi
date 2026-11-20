import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';

import { MAX_FONT_SCALE_DENSE, radius, type, useTheme } from '@/theme';

import type { BevdCanvasProps } from './bevdCanvasTypes';
import { pinSubtitle } from './copy';
import { pinText, pinsKey, regionFor } from './mapCamera';

export type { BevdCanvasProps } from './bevdCanvasTypes';

/** The disc, and the selected one. No token names a map pin. */
const PIN = 34;
const PIN_SELECTED = 42;
/** How long the camera takes to move to a new set of places. */
const CAMERA_MS = 350;

/**
 * The Map tab's surface on the iPhone (BEV-22): Apple's map with one pin per place. A pin is a disc
 * with the number of Bevs had there, and opens what was had there; a tap on the map closes it.
 *
 * The camera fits the pins it is given, and refits when that set changes (You to Friends), not when
 * the same places are refetched or one is selected, so the map stays where the person left it.
 * BevdCanvas.web.tsx is the list the web build shows instead.
 */
export function BevdCanvas({ pins, selectedId, onSelect, onClear }: BevdCanvasProps) {
  const { colors, scheme } = useTheme();
  const reduced = useReducedMotion();
  const map = useRef<MapView>(null);
  const key = pinsKey(pins);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the region follows the set of places, which `key` names
  const region = useMemo(() => regionFor(pins), [key]);
  const first = useRef(true);

  useEffect(() => {
    // The first set is the map's initialRegion; only a later one moves the camera.
    if (first.current) {
      first.current = false;
      return;
    }
    if (region) map.current?.animateToRegion(region, reduced ? 0 : CAMERA_MS);
  }, [region, reduced]);

  if (!region) return null;

  return (
    <MapView
      ref={map}
      testID="bevd-map"
      style={styles.map}
      initialRegion={region}
      userInterfaceStyle={scheme}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      onPress={(e) => {
        // A marker's own press also arrives here; only a tap on the map itself deselects.
        if (e.nativeEvent.action !== 'marker-press') onClear();
      }}
    >
      {pins.map((pin) => {
        const selected = pin.venue.id === selectedId;
        const mine = pin.mineCount > 0;
        const d = selected ? PIN_SELECTED : PIN;
        return (
          <Marker
            // The look is part of the key: a marker is a snapshot (tracksViewChanges off), so a
            // changed disc is a new marker.
            key={`${pin.venue.id}:${pin.bevCount}:${mine}:${selected}:${scheme}`}
            coordinate={{ latitude: pin.venue.lat, longitude: pin.venue.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={selected ? 10_000 : Math.min(pin.bevCount, 9_999)}
            stopPropagation
            onPress={() => onSelect(pin.venue.id)}
            accessibilityRole="button"
            accessibilityLabel={`${pin.venue.name}, ${pinSubtitle(pin)}`}
            accessibilityState={{ selected }}
          >
            {/* Filled when some are yours; a ring when they are all friends'. Never colour alone:
                the label says which, and the number is the same either way. */}
            <View
              style={[
                styles.pin,
                {
                  width: d,
                  height: d,
                  backgroundColor: mine ? colors.primary : colors.surface,
                  borderColor: mine ? colors.surface : colors.primary,
                },
              ]}
            >
              <Text
                style={[type.heading, styles.count, { color: mine ? colors.onPrimary : colors.primary }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
                numberOfLines={1}
              >
                {pinText(pin)}
              </Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  pin: { borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  count: { fontVariant: ['tabular-nums'] },
});
