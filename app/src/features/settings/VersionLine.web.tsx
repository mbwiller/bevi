import { StyleSheet, Text } from 'react-native';

import { spacing, type, useTheme } from '@/theme';

/**
 * The version at the foot of Settings. The web file: a line of text. The native one
 * (VersionLine.tsx) is also where a founder tests crash reporting, which the web build does not have.
 */
export function VersionLine({ version }: { version: string }) {
  const { colors } = useTheme();
  return <Text style={[type.caption, styles.line, { color: colors.textSecondary }]}>{`Bevi ${version}`}</Text>;
}

const styles = StyleSheet.create({
  line: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
});
