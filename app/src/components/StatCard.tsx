import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface StatCardProps {
  /** trophy, flame. */
  icon: IconName;
  /** "Rank on Bevi", "Current Streak". */
  label: string;
  /** "#12", "4 days"; "Unranked", "Rank today to start" for new users. */
  value: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-statcard { min-height: 84px; padding-left: 18px }`. */
const CARD_MIN = 84;
const PAD_LEFT = 18;

/** Profile stat card: `primary` icon, label over a `primary` value. Two per row, 10pt apart. */
export function StatCard({ icon, label, value, onPress, style }: StatCardProps) {
  const { colors } = useTheme();
  const cardStyle = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  const body = (
    <>
      <Icon name={icon} size={24} strokeWidth={1.75} color={colors.primary} />
      <View style={styles.text}>
        <Text style={[type.bodyLarge, styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[type.screenTitle, styles.value, { color: colors.primary }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </>
  );
  const a11y = typeof value === 'string' || typeof value === 'number' ? `${label}, ${value}` : label;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={cardStyle}>
      {body}
    </Pressable>
  ) : (
    <View style={cardStyle} accessible accessibilityLabel={a11y}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    minHeight: CARD_MIN,
    paddingLeft: PAD_LEFT,
    paddingRight: spacing.md,
    borderWidth: 1,
    borderRadius: radius.stat,
  },
  text: { flex: 1, minWidth: 0 },
  label: { fontWeight: '600' },
  value: { fontVariant: ['tabular-nums'] },
});
