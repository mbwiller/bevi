import type { Venue, VenueMatch } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PRESSED, TARGET_MIN } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

import { ADD_LOCATION, PICKER_TITLE, distanceLabel, placeDetail } from './copy';

/** Two lines of text beside a 22pt glyph: above the 44pt target. */
const ROW = 56;

export interface LocationRowProps {
  /** The place chosen, or null. */
  venue: Venue | null;
  /** A venue to offer when none is chosen (`useNearbySuggestion`). */
  suggestion?: VenueMatch | null;
  /** Opens the place picker. */
  onPick: () => void;
  /** Takes the suggestion as the place. */
  onAccept?: () => void;
  disabled?: boolean;
}

/**
 * Where a Bev was had, as one row of the ranking flow's note step (BEV-22). Three states:
 *
 *   - a place is chosen: its name and address, and "Change";
 *   - none, but one is suggested: "At Duane Reade?" takes it in one tap, "Other" opens the picker;
 *   - neither: "Add location" opens the picker.
 *
 * Always optional: the step's Save and Skip work the same without it.
 */
export function LocationRow({ venue, suggestion = null, onPick, onAccept, disabled = false }: LocationRowProps) {
  const { colors } = useTheme();
  const offered = !venue && suggestion && onAccept ? suggestion : null;
  const frame = [styles.row, { borderColor: colors.border, backgroundColor: colors.surface }];
  const dense = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

  if (offered) {
    const away = distanceLabel(offered.distanceMeters);
    return (
      <View style={frame} testID="location-row">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add location: ${offered.venue.name}`}
          disabled={disabled}
          onPress={onAccept}
          style={({ pressed }) => [styles.main, pressed && PRESSED]}
        >
          <Icon name="map-pin" size={22} strokeWidth={2} color={colors.primary} />
          <View style={styles.text}>
            <Text style={[type.heading, { color: colors.text }]} numberOfLines={1} {...dense}>
              {`At ${offered.venue.name}?`}
            </Text>
            <Text style={[type.body, { color: colors.textSecondary }]} numberOfLines={1} {...dense}>
              {[away ? `${away} away` : null, 'Tap to add'].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose another place"
          disabled={disabled}
          onPress={onPick}
          style={({ pressed }) => [styles.other, TARGET_MIN, pressed && PRESSED]}
        >
          <Text style={[type.heading, { color: colors.primary }]} {...dense}>
            Other
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      testID="location-row"
      accessibilityRole="button"
      accessibilityLabel={venue ? `Location: ${venue.name}. Change` : ADD_LOCATION}
      disabled={disabled}
      onPress={onPick}
      style={({ pressed }) => [frame, styles.main, pressed && PRESSED]}
    >
      <Icon name="map-pin" size={22} strokeWidth={2} color={venue ? colors.primary : colors.textSecondary} />
      <View style={styles.text}>
        <Text style={[type.heading, { color: colors.text }]} numberOfLines={1} {...dense}>
          {venue ? venue.name : ADD_LOCATION}
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]} numberOfLines={1} {...dense}>
          {venue ? (placeDetail(venue) ?? 'Tap to change') : PICKER_TITLE}
        </Text>
      </View>
      {venue ? (
        <Text style={[type.heading, { color: colors.primary }]} {...dense}>
          Change
        </Text>
      ) : (
        <Icon name="chevron-right" size={22} strokeWidth={2} color={colors.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, minWidth: 0 },
  other: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
});
