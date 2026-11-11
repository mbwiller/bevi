import type { BevSummary } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatScore } from '@/lib/format';
import { size, spacing, type, useTheme } from '@/theme';

import { BevImage } from './BevImage';
import { bevImageProps } from './BevParts';
import { ScoreBubble } from './ScoreBubble';

export type BevOfPeriodKind = 'day' | 'week';
/** What a card is labelled with: one period, or `both` when the same Bev won the day and the week. */
export type BevOfCardPeriod = BevOfPeriodKind | 'both';

/** Written in sentence case; `sectionCaps` renders it uppercase. */
export const BEV_OF_LABEL: Record<BevOfCardPeriod, string> = {
  day: 'Bev of the day',
  week: 'Bev of the week',
  both: 'Bev of the day and week',
};

export interface BevOfCardProps {
  /** `both`: the same Bev won the day and the week, so the Feed shows this one card at the width one of the pair has. */
  period?: BevOfCardPeriod;
  bev: BevSummary;
  /** The Bayesian score it won with. */
  score?: number | null;
  /** Only when the winner is from an earlier period: "Oct 17" (day), "Week of Oct 12" (week). */
  date?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The card's one accessible name: "Bev of the day: Horchata, 8.9", then the date when there is one. */
export function bevOfCardLabel(period: BevOfCardPeriod, name: string, score?: number | null, date?: string): string {
  return [`${BEV_OF_LABEL[period]}: ${name}`, score != null ? formatScore(score) : null, date].filter(Boolean).join(', ');
}

/**
 * Bev of the day / Bev of the week: half of a pair under the Feed's search bar. Just the Bev, not a
 * post: a caps label, its square tile, its name and the score it won with. The card takes the width
 * its parent gives it (`flex: 1` in the pair) and the tile follows that width, so the pair fits any
 * phone. With `period="both"` the label is longer than the tile and runs past it on one line, into
 * the half of the row the missing second card leaves empty (bundle.css `.bv-bevof-both`).
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
      {period === 'both' ? (
        // A row that doesn't shrink its child: the label keeps its whole width, so it stays on one line and
        // runs past the card's edge. No numberOfLines, which on the web caps the text at the card's width.
        <View style={styles.labelRun}>
          <Text style={[type.sectionCaps, styles.labelFull, { color: colors.textSecondary }]}>
            {BEV_OF_LABEL[period]}
          </Text>
        </View>
      ) : (
        <Text style={[type.sectionCaps, { color: colors.textSecondary }]} numberOfLines={1}>
          {BEV_OF_LABEL[period]}
        </Text>
      )}
      <View style={styles.tile}>
        {/* `size` only sets the tile's padding and corner; the style makes it fill the square. */}
        <BevImage size={size.featuredCard} {...bevImageProps(bev)} style={styles.fill} />
      </View>
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
  card: { flex: 1, minWidth: 0, minHeight: size.target, gap: spacing.sm },
  labelRun: { flexDirection: 'row', overflow: 'visible' },
  labelFull: { flexShrink: 0 },
  tile: { width: '100%', aspectRatio: 1 },
  fill: { width: '100%', height: '100%' },
  foot: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  name: { flexShrink: 1, minWidth: 0 },
  // bundle.css `.bv-bevof-date { margin-top: calc(-1 * var(--space-xs)) }`: it hangs under the name.
  date: { marginTop: -spacing.xs },
});
