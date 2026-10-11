import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, radius, size as sizes, useTheme } from '@/theme';

import { TARGET_MIN } from './HitTarget';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps {
  icon: IconName;
  /** Required: the accessible name. */
  label: string;
  /** plain: a bare outline icon with a 44pt target. filled: the grey 32pt close circle. */
  variant?: 'plain' | 'filled';
  /** Count badge in `badgeRed`. */
  badge?: number | string;
  /** Icon size for `plain` (28 in headers). */
  size?: number;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const DISC = 32;

/** A bare 28pt outline icon with a 44pt target (`plain`), or the grey 32pt close circle (`filled`). */
export function IconButton({ icon, label, variant = 'plain', badge, size = sizes.icon, onPress, disabled, style }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      style={[styles.target, style]}
    >
      {variant === 'filled' ? (
        <View style={[styles.disc, { backgroundColor: colors.input }]}>
          <Icon name={icon} size={18} strokeWidth={2.25} color={colors.textSecondary} />
        </View>
      ) : (
        <Icon name={icon} size={size} strokeWidth={1.6} color={colors.text} />
      )}
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.badgeRed }]}>
          <Text style={[styles.badgeText, { color: colors.onDeep }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// Badge geometry is the design system's (bundle.css `.bv-iconbtn-badge`).
const styles = StyleSheet.create({
  target: { ...TARGET_MIN, alignSelf: 'flex-start' },
  disc: { width: DISC, height: DISC, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
