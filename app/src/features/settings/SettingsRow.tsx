import { useContext, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Switch } from '@/components/Switch';
import { FORM_SCROLL } from '@/lib/formScroll';
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

export interface SettingsSwitchRowProps {
  label: string;
  /** A second line under the label, in `textSecondary` ("On Bevs you posted"). */
  caption?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A settings row that ends in a Switch (design system ScreenNotificationSettings): the label, an
 * optional caption under it, and the switch. The row itself is not pressable; the switch is the
 * target, and its accessible name is the row's label. 60pt tall with a caption, else 44pt.
 */
export function SettingsSwitchRow({ label, caption, checked, onChange, disabled = false }: SettingsSwitchRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, styles.switchRow, caption ? styles.withCaption : null, { borderBottomColor: colors.border }]}>
      <View style={styles.label}>
        <Text style={[type.bodyLarge, { color: colors.text }]}>{label}</Text>
        {caption ? <Text style={[type.caption, { color: colors.textSecondary }]}>{caption}</Text> : null}
      </View>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </View>
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
  // A pushed screen has no tab bar: its scroll end clears the home indicator itself.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={title} onBack={back} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + bottomInset }]} {...FORM_SCROLL}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A switch row with a second line (`.ns-row`: `min-height: 60px`). */
const SWITCH_ROW_WITH_CAPTION = 60;

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
  // The switch's own 44pt box sets the height; a caption makes it 60 (the design system's row).
  switchRow: { gap: spacing.md, paddingVertical: spacing.sm },
  withCaption: { minHeight: SWITCH_ROW_WITH_CAPTION },
  value: { flexShrink: 1, maxWidth: '50%' },
  section: { paddingTop: spacing.xxl },
  sectionTitle: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  group: { borderTopWidth: 1 },
});
