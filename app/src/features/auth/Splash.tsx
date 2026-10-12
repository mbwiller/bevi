import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/ErrorState';
import { Wordmark } from '@/components/Wordmark';
import { spacing, useTheme } from '@/theme';

const WORDMARK_HEIGHT = 56;

export interface SplashProps {
  /** The launch check failed: show why, with Retry, under the wordmark. */
  error?: unknown;
  onRetry?: () => void;
}

/** While the first session check runs: the wordmark, centred. Replaces the gate so sign in never flashes. */
export function Splash({ error, onRetry }: SplashProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={styles.center} accessibilityLabel={error ? undefined : 'Loading Bevi'} aria-busy={!error}>
        <Wordmark height={WORDMARK_HEIGHT} />
        {error ? <ErrorState error={error} onRetry={onRetry} style={styles.error} /> : null}
      </View>
    </SafeAreaView>
  );
}

/**
 * The build has no usable Supabase config (missing or wrong EXPO_PUBLIC_SUPABASE_* env vars): say so
 * instead of a blank page. Shown by the root layout in place of the whole app.
 */
export function ConfigError({ problem }: { problem: string }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={styles.center}>
        <Wordmark height={WORDMARK_HEIGHT} />
        <ErrorState title="Bevi isn't set up yet" message={problem} icon="triangle-alert" style={styles.error} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.gutter, gap: spacing.xxl },
  error: { alignSelf: 'stretch' },
});
