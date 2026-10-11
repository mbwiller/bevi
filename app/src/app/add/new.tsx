import { useLocalSearchParams } from 'expo-router';
import { lazy, Suspense } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/Skeleton';
import { size, spacing, useTheme } from '@/theme';

// Loaded on demand (§7): the wizard and the image picker/manipulator aren't needed until someone adds a Bev.
const CreateBevWizard = lazy(() => import('@/features/create-bev/CreateBevWizard').then((m) => ({ default: m.CreateBevWizard })));

function Loading() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <View style={styles.body} accessibilityLabel="Loading" aria-busy>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" width={size.bevImageStrip * 2} height={size.bevImageStrip * 2} />
        <Skeleton variant="block" height={size.target} />
      </View>
    </SafeAreaView>
  );
}

/** Create a new Bev (DEVELOPMENT-MATT §6.10), full-screen modal. `?name=` prefills the name from search. */
export default function NewBevScreen() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  return (
    <Suspense fallback={<Loading />}>
      <CreateBevWizard initialName={typeof name === 'string' ? name : ''} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: spacing.lg, padding: spacing.gutter, alignItems: 'center' },
});
