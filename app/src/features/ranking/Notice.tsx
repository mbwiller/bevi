import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { radius, spacing, type, useTheme } from '@/theme';

/** A short, polite notice above the step ("Your list changed, let's redo this one"). */
export function Notice({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.notice, { borderColor: colors.border }]} accessibilityLiveRegion="polite" role="status">
      <Icon name="refresh-cw" size={18} strokeWidth={2} color={colors.textSecondary} />
      <Text style={[type.body, styles.text, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  text: { flex: 1 },
});
