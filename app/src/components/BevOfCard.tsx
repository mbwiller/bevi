import type { BevSummary } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatScore } from '@/lib/format';
import { size, spacing, type, useTheme } from '@/theme';

import { BevImage } from './BevImage';
import { bevImageProps } from './BevParts';
import { ScoreBubble } from './ScoreBubble';

export type BevOfPeriodKind = 'day' | 'week';

/** Written in sentence case; `sectionCaps` renders it uppercase. */
export const BEV_OF_LABEL: Record<BevOfPeriodKind, string> = { day: 'Bev of the day', week: 'Bev of the week' };

export interface BevOfCardProps {
  period?: BevOfPeriodKind;
  bev: BevSummary;
  /** The Bayesian score it won with. */
  score?: number | null;
  /** Only when the winner is from an earlier period: "Oct 17" (day), "Week of Oct 12" (week). */
  date?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The card's one accessible name: "Bev of the day: Horchata, 8.9", then the date when there is one. */
export function bevOfCardLabel(period: BevOfPeriodKind, name: string, score?: number | null, date?: string): string {
  return [`${BEV_OF_LABEL[period]}: ${name}`, score != null ? formatScore(score) : null, date].filter(Boolean).join(', ');
}

/**
 * Bev of the day / Bev of the week: half of a pair under the Feed's search bar. Just the Bev, not a
 * post: a caps label, its tile (the old Featured card's 164), its name and the score it won with.
 */
export function BevOfCard({ period = 'day', bev, score, date, onPress, style }: BevOfCardProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={bevOfCardLabel(period, bev.name, score, date)}
      style={[styles.card, style]}
    >
      <Text style={[type.sectionCaps, { color: colors.textSecondary }]} numberOfLines={1}>
        {BEV_OF_LABEL[period]}
      </Text>
      <BevImage size={size.featuredCard} {...bevImageProps(bev)} />
      <View style={styles.foot}>
        <Text style={[type.heading, styles.name, { color: colors.text }]} numberOfLines={2}>
          {bev.name}
        </Text>
        <ScoreBubble score={score} />
      </View>
      {date ? <Text style={[type.caption, styles.date, { color: colors.textSecondary }]}>{date}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: size.featuredCard, minHeight: size.target, gap: spacing.sm },
  foot: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  name: { flexShrink: 1, minWidth: 0 },
  // bundle.css `.bv-bevof-date { margin-top: calc(-1 * var(--space-xs)) }`: it hangs under the name.
  date: { marginTop: -spacing.xs },
});
