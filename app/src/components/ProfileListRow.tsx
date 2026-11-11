import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { usePressFeedback } from './PressFeedback';

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

/**
 * Profile link row (44pt): icon, 20pt label, count, chevron. Full-bleed, so under the finger its
 * content gives way (Press) while the row's background and divider stay put.
 */
export function ProfileListRow({ icon, iconFilled = false, label, count, onPress, divider = true, style }: ProfileListRowProps) {
  const { colors } = useTheme();
  const press = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      <Animated.View style={[styles.content, press.style]} testID="profile-list-row-content">
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
      </Animated.View>
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
  // The row's own row layout, one level in: the press scales this, not the row's box.
  content: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  icon: { marginRight: ICON_GAP },
  label: { flex: 1, minWidth: 0 },
  count: { marginRight: spacing.sm, fontVariant: ['tabular-nums'] },
});
