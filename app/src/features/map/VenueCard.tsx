import type { VenuePin } from '@bevi/shared';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconButton } from '@/components/IconButton';
import { ScoreBubble } from '@/components/ScoreBubble';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

import { KIND_LABEL, pinScore } from './pinContent';

/** Open now is best-effort (A-08): null means the hours couldn't be read, never "closed". */
export function openLabel(openNow: boolean | null): string {
  return openNow == null ? 'Hours unknown' : openNow ? 'Open now' : 'Closed now';
}

export function bevCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'Bev' : 'Bevs'}`;
}

export interface VenueCardProps {
  pin: VenuePin;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The tapped pin's venue, as a card along the bottom of the map (M-16 part 1). Deliberately
 * minimal: part 2 replaces it with the design system's VenueSheet and the Bevs sold there.
 */
export function VenueCard({ pin, onClose, style }: VenueCardProps) {
  const { colors } = useTheme();
  const { venue } = pin;
  const { value, predicted } = pinScore(pin);
  const meta = [KIND_LABEL[venue.kind], venue.neighborhood].filter(Boolean).join(' · ');
  return (
    <View
      testID="venue-card"
      accessibilityLabel={`${venue.name}, ${meta}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
    >
      {value == null ? null : <ScoreBubble score={value} variant={predicted ? 'predicted' : 'default'} />}
      <View style={styles.text}>
        <Text style={[type.heading, { color: colors.text }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {venue.name}
        </Text>
        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {meta}
        </Text>
        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {`${openLabel(pin.openNow)} · ${bevCountLabel(pin.bevCount)}`}
        </Text>
      </View>
      <IconButton icon="x" variant="filled" label="Close" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  text: { flex: 1, minWidth: 0, gap: spacing.xs },
});
