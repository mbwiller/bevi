import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { hitSlopFor, PRESSED } from './pressed';

export interface PillProps {
  variant?: 'filled' | 'outlined';
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon (a chevron for menus). */
  iconRight?: IconName;
  /** Outlined only: selected state in `primaryTint`. */
  active?: boolean;
  /** The label, sentence case. */
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Defaults to the label when it is a string. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const GAP = 6;
/** Same as Button's disabled state (the design system only specifies it for Button). */
const DISABLED_OPACITY = 0.45;

/** Rounded 30pt pill: filled (`primary`) for actions, outlined for options. Hit area extends to 44pt. */
export function Pill({ variant = 'outlined', icon, iconRight, active = false, children, onPress, disabled, accessibilityLabel, style }: PillProps) {
  const { colors } = useTheme();
  const filled = variant === 'filled';
  const selected = !filled && active;
  const fg = filled ? colors.onPrimary : selected ? colors.primary : colors.text;
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlopFor(size.pill)}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      // aria-pressed marks the outlined toggle; RN's types lack it but react-native-web renders it.
      {...(filled ? null : ({ 'aria-pressed': active } as object))}
      style={({ pressed }) => [
        styles.pill,
        filled
          ? { backgroundColor: colors.primary }
          : {
              backgroundColor: selected ? colors.primaryTint : colors.surface,
              borderColor: selected ? colors.primary : colors.borderStrong,
              borderWidth: 1,
            },
        disabled && styles.disabled,
        pressed && PRESSED,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} strokeWidth={2} color={fg} /> : null}
      {children != null ? (
        <Text style={[styles.label, filled && styles.labelFilled, { color: fg }]} numberOfLines={1}>
          {children}
        </Text>
      ) : null}
      {iconRight ? <Icon name={iconRight} size={16} strokeWidth={2} color={fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: GAP,
    height: size.pill,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  label: { ...type.body, fontWeight: '500' },
  labelFilled: { fontWeight: '600' },
  disabled: { opacity: DISABLED_OPACITY },
});
