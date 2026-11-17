import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { Shimmer } from './BevImage';
import { BEV_ROW_FOOT_LINE } from './BevRow';

export interface SkeletonProps {
  /** row: a BevRow. post: a FeedPost. text, block and circle: plain shapes sized by `width`/`height`. */
  variant?: 'text' | 'block' | 'circle' | 'row' | 'post';
  width?: DimensionValue;
  height?: number;
  /** text: number of lines (the last is 60% wide). */
  lines?: number;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-skel { border-radius: 6px }` and the design system's bone sizes. */
const BONE_RADIUS = 6;
const LINE = 14;
const TITLE = 20;
const BLOCK = 120;
const CIRCLE = 40;
const AVATAR = 60;

/** One grey `input` bone with the shimmer (which holds still under reduced motion). */
function Bone({ width, height, round, style }: { width: DimensionValue; height: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.bone, { width, height, backgroundColor: colors.input }, round && styles.round, style]}
      aria-hidden
    >
      <Shimmer />
    </View>
  );
}

const busy = { accessible: true, accessibilityLabel: 'Loading', 'aria-busy': true } as const;

/** Loading placeholder in the shape of the final layout; every list loads with this, never a bare spinner. */
export function Skeleton({ variant = 'text', width, height, lines = 1, style }: SkeletonProps) {
  const { colors } = useTheme();
  if (variant === 'row') {
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }, style]} {...busy}>
        <View style={styles.rowTop}>
          <View style={styles.rowText} testID="skeleton-row-text">
            <View style={styles.rowTitle} testID="skeleton-row-title">
              <Bone width="58%" height={TITLE} />
            </View>
            <View style={styles.rowLine} testID="skeleton-row-line">
              <Bone width="40%" height={LINE} />
            </View>
          </View>
          <Bone width={CIRCLE} height={CIRCLE} round style={styles.rowScore} />
        </View>
        <View style={styles.rowFoot} testID="skeleton-row-foot">
          <Bone width="28%" height={LINE} />
          <Bone width={size.icon} height={size.icon} round />
        </View>
      </View>
    );
  }
  if (variant === 'post') {
    return (
      <View style={[styles.post, style]} {...busy}>
        <View style={styles.head}>
          <Bone width={AVATAR} height={AVATAR} round />
          <View style={styles.lines}>
            <Bone width="80%" height={TITLE} />
            <Bone width="50%" height={LINE} />
          </View>
        </View>
        <Bone width={size.bevImageStrip} height={size.bevImageStrip} style={styles.photo} />
        <Bone width="90%" height={LINE} />
      </View>
    );
  }
  if (variant === 'circle') {
    const d = typeof width === 'number' ? width : CIRCLE;
    return <Bone width={d} height={height ?? d} round style={style} />;
  }
  if (variant === 'block') {
    return <Bone width={width ?? '100%'} height={height ?? BLOCK} style={[styles.photo, style]} />;
  }
  return (
    <View style={[styles.lines, style]} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 && lines > 1 ? '60%' : (width ?? '100%')} height={height ?? LINE} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bone: { overflow: 'hidden', borderRadius: BONE_RADIUS },
  round: { borderRadius: radius.pill, flexShrink: 0 },
  photo: { borderRadius: radius.photo },
  lines: { flex: 1, minWidth: 0, gap: spacing.sm },
  // A compact BevRow: name line, category line, then the 32pt foot; the bubble sits top right.
  row: {
    minHeight: size.rowMin,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  // No gap, unlike `lines`: the two slots are exactly the real row's 25pt name and 20pt category lines.
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { height: type.screenTitle.lineHeight, justifyContent: 'center' },
  rowLine: { height: type.body.lineHeight, justifyContent: 'center' },
  rowScore: { marginTop: 2, marginRight: spacing.xs },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: BEV_ROW_FOOT_LINE },
  post: { gap: spacing.lg, paddingVertical: spacing.lg, paddingHorizontal: spacing.gutter },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxl },
});
