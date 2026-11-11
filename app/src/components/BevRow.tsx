import type { BevSummary, Bucket } from '@bevi/shared';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { categoryById } from '@/lib/categories';
import { formatRatings } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { BevActions, bevImageProps, brandLine } from './BevParts';
import { BevImage } from './BevImage';
import { Icon } from './Icon';
import { FeedbackPressable } from './PressFeedback';
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

/**
 * The compact (~94pt) list row: an optional 56pt image, the name and one line of category icon and
 * "Category · Brand", and a ScoreBubble 40. The foot (meta left, actions right) sits directly under the
 * category line, from the text column's left edge to the row's right edge (the full row with no image).
 * The foot line is 32pt; the action buttons keep their 44pt targets by overlapping it 6pt above and below
 * (no `hitSlop`: react-native-web ignores it). No price on a row (D-06): it shows on Bev detail only.
 */
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
  const secondary = [cat?.label, brandLine(bev)].filter(Boolean).join(' · ');
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
        {/* Press: the button (image and text) gives way; the row's background and divider stay put. */}
        <FeedbackPressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={prefix + bev.name}
          style={[styles.main, showImage && styles.mainWithImage]}
        >
          {/* Absolute, so the button is only as tall as the text and the foot starts right under it. */}
          {showImage ? (
            <View style={styles.image}>
              <BevImage size={IMAGE} {...bevImageProps(bev)} />
            </View>
          ) : null}
          <View>
            <Text {...DENSE} style={[type.screenTitle, { color: colors.text }]} numberOfLines={1}>
              {prefix + bev.name}
            </Text>
            <View style={styles.line}>
              {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.text} /> : null}
              {secondary ? (
                <Text {...DENSE} style={[type.body, styles.shrink, { color: colors.text }]} numberOfLines={1}>
                  {secondary}
                </Text>
              ) : null}
            </View>
          </View>
        </FeedbackPressable>
        {score !== undefined || scoreVariant ? (
          <View style={styles.score}>
            <ScoreBubble score={score} variant={scoreVariant} bucket={bucket} />
          </View>
        ) : null}
      </View>
      <View style={[styles.foot, showImage && styles.footWithImage]}>
        <Text {...DENSE} style={[type.body, styles.shrink, { color: colors.textSecondary }]} numberOfLines={1}>
          {meta != null && meta !== '' ? meta : count != null && count > 0 ? formatRatings(count) : null}
        </Text>
        {actions ? (
          <View style={styles.actions}>
            <BevActions name={bev.name} saved={saved} onRank={onRank} onSave={onSave} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const IMAGE = 56;
/** The foot's left edge with an image: the text column's, past the image and the gap. */
const TEXT_INDENT = IMAGE + spacing.md;
/** The foot line is 32pt; the 44pt action buttons overlap it by (44 - 32) / 2 above and below. */
export const BEV_ROW_FOOT_LINE = 32;
const ACTION_OVERLAP = (size.target - BEV_ROW_FOOT_LINE) / 2;
const DIVIDER_WIDTH = 1;

/**
 * For a caller that overlays its own 44pt control on a row (the Bev'd list's overflow menu): the
 * `bottom` that centres it on the foot line, measured from the bottom of the View that wraps the row
 * (a row with its divider, the default). The foot line ends `spacing.xs` plus the divider above the
 * row's bottom edge, and the control overhangs it by the same 6pt the row's own actions do.
 */
export const BEV_ROW_FOOT_OVERLAY_BOTTOM = spacing.xs + DIVIDER_WIDTH - ACTION_OVERLAP;

const styles = StyleSheet.create({
  row: {
    minHeight: size.rowMin,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.gutter,
  },
  divider: { borderBottomWidth: DIVIDER_WIDTH },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0 },
  mainWithImage: { paddingLeft: TEXT_INDENT },
  image: { position: 'absolute', left: 0, top: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  shrink: { flexShrink: 1, minWidth: 0 },
  // bundle.css `.bv-bevrow-score { padding: 2px 4px 0 var(--space-md) }`.
  score: { paddingTop: 2, paddingRight: spacing.xs, paddingLeft: spacing.md },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: BEV_ROW_FOOT_LINE,
  },
  // A margin, not padding: the foot's box must start at the text column so it never covers the image's
  // lower 11pt (which overhangs the 45pt text block) and steals its taps.
  footWithImage: { marginLeft: TEXT_INDENT },
  // BevActions already has marginRight -8; these negative margins let the 44pt buttons overhang the 32pt line.
  actions: { marginVertical: -ACTION_OVERLAP },
});
