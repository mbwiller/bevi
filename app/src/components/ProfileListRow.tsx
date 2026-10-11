import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface ProfileListRowProps {
  /** circle-check (Bev'd), bookmark with `iconFilled` (Want to Try), heart (Recommended for you). */
  icon: IconName;
  iconFilled?: boolean;
  label: string;
  /** Omit on Recommended for you. */
  count?: number;
  onPress?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-plrow-icon { margin-right: 23px }`. */
const ICON_GAP = 23;

/** Profile link row (44pt): icon, 20pt label, count, chevron. */
export function ProfileListRow({ icon, iconFilled = false, label, count, onPress, divider = true, style }: ProfileListRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      <Icon name={icon} size={24} strokeWidth={1.75} filled={iconFilled} color={colors.text} style={styles.icon} />
      <Text style={[type.tabLabel, styles.label, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {label}
      </Text>
      {count != null ? (
        <Text style={[type.tabLabel, styles.count, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {count}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={20} strokeWidth={2} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: size.target,
    paddingLeft: spacing.xl,
    paddingRight: spacing.gutter,
  },
  divider: { borderBottomWidth: 1 },
  icon: { marginRight: ICON_GAP },
  label: { flex: 1, minWidth: 0 },
  count: { marginRight: spacing.sm, fontVariant: ['tabular-nums'] },
});
