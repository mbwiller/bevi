import type { BevSummary, Bucket } from '@bevi/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { categoryById } from '@/lib/categories';
import { formatRatings } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { BevActions, bevImageProps, brandLine } from './BevParts';
import { BevImage } from './BevImage';
import { Icon } from './Icon';
import { PriceTier } from './PriceTier';
import { ScoreBubble } from './ScoreBubble';

export interface BevRowProps {
  bev: BevSummary;
  /** List position (Bev'd, Leaderboard): "1. Diet Coke". */
  number?: number;
  /** Shows a ScoreBubble; null (or `scoreVariant="locked"`) shows the lock. Omit for no bubble. */
  score?: number | null;
  scoreVariant?: 'default' | 'predicted' | 'locked';
  /** The viewer's own bucket, when known: the bubble takes the bucket colour. */
  bucket?: Bucket;
  /** Global rating count; shown as "362 ratings" in the meta line when `meta` is not given. */
  count?: number;
  /** Bottom-left line: "Ranked Oct 3", "Saved from @arjun", a recommendation reason. */
  meta?: ReactNode;
  saved?: boolean;
  /** Rank and Want to Try buttons (each needs its handler). */
  actions?: boolean;
  /** A 56pt BevImage, for search results and "Did you mean…". */
  showImage?: boolean;
  divider?: boolean;
  onRank?: () => void;
  onSave?: () => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

/** The ~126pt list row: name, `$$ • Category`, category icon • brand, a meta line, actions and a ScoreBubble 40. */
export function BevRow({
  bev,
  number,
  score,
  scoreVariant,
  bucket,
  count,
  meta,
  saved = false,
  actions = true,
  showImage = false,
  divider = true,
  onRank,
  onSave,
  onPress,
  style,
}: BevRowProps) {
  const { colors } = useTheme();
  const cat = categoryById(bev.categoryId);
  const brand = brandLine(bev);
  const prefix = number != null ? `${number}. ` : '';
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      <View style={styles.top}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={prefix + bev.name} style={styles.main}>
          {showImage ? <BevImage size={56} {...bevImageProps(bev)} /> : null}
          <View style={styles.text}>
            <Text {...DENSE} style={[type.screenTitle, { color: colors.text }]} numberOfLines={1}>
              {prefix + bev.name}
            </Text>
            <Text {...DENSE} style={[type.body, { color: colors.text }]} numberOfLines={1}>
              <PriceTier tier={bev.priceTier} estimated={bev.priceEstimated} />
              {cat ? ` • ${cat.label}` : ''}
            </Text>
            <View style={styles.line}>
              {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.text} /> : null}
              {brand ? (
                <Text {...DENSE} style={[type.body, styles.shrink, { color: colors.text }]} numberOfLines={1}>
                  {` • ${brand}`}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
        {score !== undefined || scoreVariant ? (
          <View style={styles.score}>
            <ScoreBubble score={score} variant={scoreVariant} bucket={bucket} />
          </View>
        ) : null}
      </View>
      <View style={styles.foot}>
        <Text {...DENSE} style={[type.body, styles.shrink, { color: colors.textSecondary }]} numberOfLines={1}>
          {meta != null && meta !== '' ? meta : count != null && count > 0 ? formatRatings(count) : null}
        </Text>
        {actions ? <BevActions name={bev.name} saved={saved} onRank={onRank} onSave={onSave} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: size.rowMin,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.gutter,
  },
  divider: { borderBottomWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  shrink: { flexShrink: 1, minWidth: 0 },
  // bundle.css `.bv-bevrow-score { padding: 2px 4px 0 var(--space-md) }`.
  score: { paddingTop: 2, paddingRight: spacing.xs, paddingLeft: spacing.md },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.target,
    marginTop: spacing.md,
  },
});
