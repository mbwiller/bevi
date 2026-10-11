import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { PRESSED } from '@/components/HitTarget';
import { spacing, type, useTheme } from '@/theme';

/** Sheet option rows are 48pt (Sheet's contract), above the 44pt target. */
const ROW = 48;

export interface SheetOptionProps {
  label: string;
  icon?: IconName;
  /** A `primary` check marks the chosen option. */
  selected?: boolean;
  /** Destructive actions read in `scoreLow`, with their icon; never colour alone. */
  destructive?: boolean;
  /** Trailing detail, e.g. a count. */
  detail?: ReactNode;
  onPress?: () => void;
}

/** One 48pt row in a Sheet: label, optional icon and detail, a check when selected. */
export function SheetOption({ label, icon, selected, destructive, detail, onPress }: SheetOptionProps) {
  const { colors } = useTheme();
  const fg = destructive ? colors.scoreLow : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(selected === undefined ? null : ({ 'aria-pressed': selected } as object))}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && PRESSED]}
    >
      {icon ? <Icon name={icon} size={22} strokeWidth={2} color={fg} /> : null}
      <Text style={[type.bodyLarge, styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {detail != null ? <Text style={[type.body, { color: colors.textSecondary }]}>{detail}</Text> : null}
      {selected ? <Icon name="check" size={22} strokeWidth={2} color={colors.primary} /> : null}
    </Pressable>
  );
}

/** A `sectionCaps` label between groups of options. */
export function SheetSection({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[type.sectionCaps, { color: colors.textSecondary }]} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  label: { flex: 1 },
  section: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.sm },
});
