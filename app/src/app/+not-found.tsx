import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ReportBugLauncher } from '@/features/bug-report/ReportBugLauncher';
import { useTheme } from '@/theme';

/**
 * Any URL that matches no route. Home is `/`, which the session gate sends to the right place.
 * It draws no Header, so an internal reporter gets the floating Report a bug pill here instead of
 * the header action (it renders nothing for anyone else, or when signed out).
 */
export default function NotFoundScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.surface }]}>
      <EmptyState
        icon="triangle-alert"
        title="Page not found"
        body="This link doesn't go anywhere in Bevi."
        action="Go home"
        onAction={() => router.replace('/')}
      />
      <ReportBugLauncher />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
});
