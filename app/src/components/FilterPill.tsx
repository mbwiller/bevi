import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { HitTarget, PRESSED } from './HitTarget';
import { Icon, type IconName } from './Icon';

export interface FilterPillProps {
  /** Active filters. Above 0 the pill turns `primaryTint` and shows a `primary` count badge. */
  count?: number;
  /** Single-facet pills (Bucket, Price, Category) name their facet. */
  label?: string;
  /** Leading glyph; `null` drops it. */
  icon?: IconName | null;
  /** Trailing chevron for single-facet pills. */
  chevron?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const BADGE = 20;

/** Outlined pill that opens the filter sheet; shows a `primary` count badge and turns `primaryTint` while filters are on. */
export function FilterPill({ count = 0, label, icon = 'list-filter', chevron = false, onPress, style }: FilterPillProps) {
  const { colors } = useTheme();
  const active = count > 0;
  const fg = active ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={(label || 'Filters') + (active ? `, ${count} on` : '')}
      // It opens the filter Sheet.
      {...({ 'aria-haspopup': 'dialog' } as object)}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: active ? colors.primaryTint : colors.surface,
          borderColor: active ? colors.primary : colors.borderStrong,
        },
        pressed && PRESSED,
        style,
      ]}
    >
      <HitTarget height={size.pill} borderWidth={1} />
      {icon ? <Icon name={icon} size={18} strokeWidth={2} color={fg} /> : null}
      {label ? (
        <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {active ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.badgeText, { color: colors.onPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {count}
          </Text>
        </View>
      ) : null}
      {chevron ? <Icon name="chevron-down" size={16} strokeWidth={2} color={fg} /> : null}
    </Pressable>
  );
}

// Geometry from bundle.css `.bv-filter` / `.bv-count-badge`.
const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: size.pill,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: { ...type.body, fontWeight: '500' },
  badge: {
    minWidth: BADGE,
    height: BADGE,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
