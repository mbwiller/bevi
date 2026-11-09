import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { spacing, type, useTheme } from '@/theme';

export const MAP_UNAVAILABLE = 'Map unavailable right now';

/**
 * The Search tab's map area when there is no live map (design system ScreenSearch): no key in this
 * build, the Maps JS API failed to load, or Google rejected the key (M-16). Honest on purpose: no
 * pins and no fake streets, never Google's grey "can't load" box. Search keeps working above it.
 */
export function MapPlaceholder() {
  const { colors } = useTheme();
  return (
    <View testID="map-placeholder" style={[styles.fill, { backgroundColor: colors.input }]}>
      <Icon name="map" size={28} strokeWidth={1.6} color={colors.textSecondary} />
      <Text style={[type.heading, { color: colors.text }]}>{MAP_UNAVAILABLE}</Text>
      <Text style={[type.body, styles.body, { color: colors.textSecondary }]}>
        You can still search for Bevs and people above.
      </Text>
    </View>
  );
}

/** ScreenSearch `.sr-map { padding: 0 40px }`: no token names it. */
const SIDE = 40;

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: SIDE },
  body: { textAlign: 'center' },
});
