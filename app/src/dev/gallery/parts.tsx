import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, type, useTheme } from '@/theme';

/** A component heading inside a gallery section. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

/** A wrapping row of specimens. */
export function Row({ children, align = 'flex-end' }: { children: ReactNode; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return <View style={[styles.row, { alignItems: align }]}>{children}</View>;
}

/** One specimen with a caption under it. */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.specimen}>
      {children}
      <Text style={[type.caption, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md, paddingVertical: spacing.lg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  specimen: { gap: spacing.sm, alignItems: 'flex-start' },
});
