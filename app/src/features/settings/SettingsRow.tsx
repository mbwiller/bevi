import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { useBack } from '@/lib/useBack';
import { size, spacing, type, useTheme } from '@/theme';

export interface SettingsRowProps {
  label: string;
  /** Current value on the right, in `textSecondary` (e.g. the timezone). */
  value?: string;
  onPress?: () => void;
  /** A link to another screen: shows the chevron. Off for actions such as Sign out. */
  chevron?: boolean;
  /** Spinner in place of the chevron while the row's action runs. */
  busy?: boolean;
  /** Accessible name when it should differ from the label. */
  accessibilityLabel?: string;
}

/** A full-bleed settings row (44pt minimum) with a 1pt divider: label, optional value, chevron. */
export function SettingsRow({ label, value, onPress, chevron = true, busy = false, accessibilityLabel }: SettingsRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole={chevron ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      aria-busy={busy}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.input }]}
    >
      <Text style={[type.bodyLarge, styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={[type.body, styles.value, { color: colors.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      {!busy && chevron ? <Icon name="chevron-right" size={20} strokeWidth={2} color={colors.textSecondary} /> : null}
    </Pressable>
  );
}

/** A `sectionCaps` label over a group of rows. */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[type.sectionCaps, styles.sectionTitle, { color: colors.textSecondary }]} role="heading" aria-level={2}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { borderTopColor: colors.border }]}>{children}</View>
    </View>
  );
}

/** A pushed settings screen: back header and a scrolling body. */
export function SettingsScreen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const back = useBack();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={title} onBack={back} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: size.target,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  label: { flex: 1, minWidth: 0 },
  value: { flexShrink: 1, maxWidth: '50%' },
  section: { paddingTop: spacing.xxl },
  sectionTitle: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  group: { borderTopWidth: 1 },
});
