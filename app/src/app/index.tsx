import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/Wordmark';
import { size, spacing, type, useTheme } from '@/theme';

// Placeholder until the session gate and tabs land (task 1.3): the dev screens.
export default function Index() {
  const { colors } = useTheme();
  const link = [type.bodyLarge, styles.link, { color: colors.primary }];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={styles.content}>
        <Wordmark height={40} />
        <Link href="/dev/gallery" style={link} accessibilityLabel="Component gallery">
          Component gallery
        </Link>
        <Link href="/dev/tokens" style={link} accessibilityLabel="Token preview">
          Token preview
        </Link>
        <Text style={[type.caption, { color: colors.textSecondary }]}>Dev screens. The app shell replaces this page.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.gutter },
  link: { minHeight: size.target, paddingVertical: spacing.md, fontWeight: '600' },
});
