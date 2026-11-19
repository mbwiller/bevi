import type { VenueKind } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PRESSED } from '@/components/HitTarget';
import { Icon, type IconName } from '@/components/Icon';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

/** A place row is two lines of text: taller than a Sheet's 48pt option, and above the 44pt target. */
const ROW = 60;
/** The disc behind the glyph, as the EmptyState's is to its icon, at row scale. */
const DISC = 36;

/** A chain reads as a shop front, anything else as a cup: the map pins' two glyphs. */
const KIND_ICON: Record<VenueKind, IconName> = { chain: 'store', craft: 'coffee' };

export interface PlaceRowProps {
  name: string;
  /** "425 Main Street · 150 ft"; an empty string draws one line. */
  subtitle?: string;
  /** Omitted for a place that is not a venue yet (a "more places" result). */
  kind?: VenueKind;
  /** A `primary` check: the place this Bev has now. */
  selected?: boolean;
  /** The row is being saved: it dims and takes no press. */
  busy?: boolean;
  onPress?: () => void;
}

/** One place in the picker and in the Map tab's list: glyph, name, where it is and how far. */
export function PlaceRow({ name, subtitle, kind, selected = false, busy = false, onPress }: PlaceRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${name}, ${subtitle}` : name}
      accessibilityState={{ selected, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && PRESSED, busy && styles.busy]}
    >
      <View style={[styles.disc, { backgroundColor: colors.input }]}>
        <Icon name={kind ? KIND_ICON[kind] : 'map-pin'} size={20} strokeWidth={2} color={colors.textSecondary} />
      </View>
      <View style={styles.text}>
        <Text style={[type.heading, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {name}
        </Text>
        {subtitle ? (
          <Text
            style={[type.body, { color: colors.textSecondary }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={22} strokeWidth={2} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  disc: { width: DISC, height: DISC, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  busy: { opacity: 0.5 },
});
