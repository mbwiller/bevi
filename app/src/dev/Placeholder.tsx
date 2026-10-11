import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Header, type HeaderProps } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { size, spacing, type, useTheme } from '@/theme';

export interface PlaceholderProps {
  /** The screen's name, shown in the body. */
  title: string;
  /** The screen's real header (title, wordmark, back, close), as the design system draws it. */
  header: HeaderProps;
  /** Links the shell needs before the real screen exists (e.g. Settings → Account). */
  children?: ReactNode;
}

/**
 * TEMPORARY. The body of a route whose screen isn't built yet: its Header and "Coming soon".
 * Each screen PR replaces its route's Placeholder; delete this file when none are left.
 */
export function Placeholder({ title, header, children }: PlaceholderProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header {...header} />
      <ScrollView contentContainerStyle={styles.body}>
        <EmptyState icon="clock" title={title} body="Coming soon" />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** TEMPORARY. Plain rows linking to other routes, so the shell is walkable before the real screens exist. */
export function PlaceholderLinks({ links }: { links: { label: string; href: Href }[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.links, { borderTopColor: colors.border }]}>
      {links.map((l) => (
        <Link key={l.label} href={l.href} asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={l.label}
            // On web, Link's asChild slot hands the child's style to the DOM as is: one flat object, no array or function.
            style={StyleSheet.flatten([styles.row, { borderBottomColor: colors.border }])}
          >
            <Text style={[type.bodyLarge, styles.rowLabel, { color: colors.text }]}>{l.label}</Text>
            <Icon name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: spacing.gutter, gap: spacing.xl },
  links: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    minHeight: size.target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
});
