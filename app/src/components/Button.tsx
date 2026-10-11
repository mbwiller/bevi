import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { HitTarget, PRESSED } from './HitTarget';

export interface ButtonProps {
  variant?: 'outlined' | 'primary' | 'ghost';
  /** md = 36pt (default for outlined and ghost), lg = 52pt (default for primary). */
  size?: 'md' | 'lg';
  icon?: IconName;
  /** Full width. */
  block?: boolean;
  /** Spinner, "Working…", disabled. */
  loading?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  onPress?: () => void;
  /** Required for an icon-only button; defaults to the label when it is a string. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT = { md: 36, lg: 52 } as const;
const DISABLED_OPACITY = 0.45;

/** Rectangular button: outlined 36pt (profile row), primary 52pt for a screen's one main action, ghost text. */
export function Button({
  variant = 'outlined',
  size,
  icon,
  block = false,
  loading = false,
  disabled = false,
  children,
  onPress,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const sz = size ?? (variant === 'primary' ? 'lg' : 'md');
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'ghost' ? colors.primary : colors.text;
  const inactive = disabled || loading;
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={inactive}
      aria-busy={loading}
      style={({ pressed }) => [
        styles.base,
        sz === 'lg' ? styles.lg : styles.md,
        variant === 'outlined' && { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 },
        variant === 'primary' && { backgroundColor: colors.primary },
        block ? styles.block : styles.inline,
        inactive && styles.disabled,
        pressed && PRESSED,
        style,
      ]}
    >
      <HitTarget height={HEIGHT[sz]} borderWidth={variant === 'outlined' ? 1 : 0} />
      {loading ? (
        <View style={styles.spinner}>
          <ActivityIndicator size="small" color={fg} />
        </View>
      ) : icon ? (
        <Icon name={icon} size={sz === 'lg' ? 22 : 18} strokeWidth={2} color={fg} />
      ) : null}
      {children != null ? (
        <Text
          style={[sz === 'lg' ? styles.labelLg : styles.labelMd, variant !== 'outlined' && styles.bold, { color: fg }]}
          numberOfLines={1}
        >
          {loading ? 'Working…' : children}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  md: { height: HEIGHT.md, paddingHorizontal: spacing.lg, borderRadius: radius.button },
  lg: { height: HEIGHT.lg, paddingHorizontal: spacing.xxl, borderRadius: radius.input },
  inline: { alignSelf: 'flex-start' },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: DISABLED_OPACITY },
  spinner: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  labelMd: { ...type.body },
  labelLg: { ...type.heading },
  bold: { fontWeight: '600' },
});
