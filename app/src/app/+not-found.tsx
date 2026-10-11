import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme';

/** Any URL that matches no route. Home is `/`, which the session gate sends to the right place. */
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
});
