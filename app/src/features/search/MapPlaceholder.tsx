import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { spacing, type, useTheme } from '@/theme';

/**
 * The Search tab's map area until the live New York City map lands (M-16; design system
 * ScreenSearch). Honest on purpose: no pins and no fake streets, just what will show here.
 */
export function MapPlaceholder() {
  const { colors } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: colors.input }]}>
      <Icon name="map" size={28} strokeWidth={1.6} color={colors.textSecondary} />
      <Text style={[type.heading, { color: colors.text }]}>Map coming soon</Text>
      <Text style={[type.body, styles.body, { color: colors.textSecondary }]}>
        Spots across New York City that carry your Bevs will show up here.
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
