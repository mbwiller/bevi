import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Pill } from './Pill';

export interface EmptyStateProps {
  icon?: IconName;
  /** What will appear here: "Follow friends to see their Bevs". */
  title: string;
  body?: string;
  /** The action that fixes it: "Find people", "Add your first Bev". */
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-empty-icon` (56pt disc) and `.bv-empty-body { max-width: 280px }`. */
const DISC = 56;
const BODY_MAX = 280;

/** The centred icon, title, help line and action that EmptyState and ErrorState share. */
export function StateMessage({
  icon,
  title,
  body,
  children,
  style,
  alert = false,
}: {
  icon: IconName;
  title: string;
  body?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  alert?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]} {...(alert ? { accessibilityRole: 'alert' as const } : null)}>
      <View style={[styles.disc, { backgroundColor: colors.input }]}>
        <Icon name={icon} size={28} strokeWidth={1.75} color={colors.textSecondary} />
      </View>
      <Text style={[type.heading, styles.center, { color: colors.text }]}>{title}</Text>
      {body ? <Text style={[type.body, styles.center, styles.body, { color: colors.textSecondary }]}>{body}</Text> : null}
      {children}
    </View>
  );
}

/** Centred message for an empty list, with one action. */
export function EmptyState({ icon = 'cup-soda', title, body, action, onAction, style }: EmptyStateProps) {
  return (
    <StateMessage icon={icon} title={title} body={body} style={style}>
      {action ? (
        <Pill variant="filled" onPress={onAction} style={styles.action}>
          {action}
        </Pill>
      ) : null}
    </StateMessage>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.gutter },
  disc: {
    width: DISC,
    height: DISC,
    marginBottom: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  body: { maxWidth: BODY_MAX, marginBottom: spacing.sm },
  action: { alignSelf: 'center' },
});
