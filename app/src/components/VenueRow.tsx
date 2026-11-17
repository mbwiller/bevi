import type { Venue } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatScore } from '@/lib/format';
import { bevCountLabel, openLabel, venueMeta } from '@/lib/venue';
import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';

import { PRESSED } from './HitTarget';
import { ScoreBubble } from './ScoreBubble';

export interface VenueRowProps {
  venue: Pick<Venue, 'name' | 'kind' | 'neighborhood' | 'borough'>;
  openNow?: boolean | null;
  /** The pin's score; null or omitted: no bubble. */
  score?: number | null;
  predicted?: boolean;
  /** How many Bevs it carries. */
  bevs?: number;
  divider?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-venuerow { min-height: 88px }`: no token names it. */
const ROW_MIN = 88;
const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

/** A venue in the map's List view (design system VenueRow): name, kind and neighborhood, open state and Bev count, the pin's score. */
export function VenueRow({ venue, openNow = null, score, predicted = false, bevs = 1, divider = true, onPress, style }: VenueRowProps) {
  const { colors } = useTheme();
  const meta = venueMeta(venue);
  const status = `${openLabel(openNow)} · ${bevCountLabel(bevs)}`;
  const spoken =
    score == null ? 'no score yet' : `${predicted ? 'predicted score' : 'score'} ${formatScore(score)}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[venue.name, meta, status, spoken].filter(Boolean).join(', ')}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, backgroundColor: colors.surface },
        divider && styles.divider,
        pressed && PRESSED,
        style,
      ]}
    >
      <View style={styles.text}>
        <Text {...DENSE} style={[type.heading, { color: colors.text }]} numberOfLines={1}>
          {venue.name}
        </Text>
        {meta ? (
          <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {score != null ? <ScoreBubble score={score} variant={predicted ? 'predicted' : 'default'} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: ROW_MIN,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  divider: { borderBottomWidth: 1 },
  text: { flex: 1, minWidth: 0 },
});
