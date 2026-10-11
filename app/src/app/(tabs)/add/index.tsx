import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { SegmentedTabs, type Tab } from '@/components/SegmentedTabs';
import { BevSearch } from '@/features/add-bev/BevSearch';
import { useBack } from '@/lib/useBack';
import { useTheme } from '@/theme';

type AddTab = 'bevs' | 'people';

const TABS: Tab[] = [
  { id: 'bevs', label: 'Bevs', icon: 'cup-soda' },
  { id: 'people', label: 'People', icon: 'users' },
];

/** Add Bev (DEVELOPMENT-MATT §6.8, design system ScreenAddBev). `?tab=people` opens People. */
export default function AddBevScreen() {
  const back = useBack();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: AddTab = params.tab === 'people' ? 'people' : 'bevs';
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header wordmark actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: back }]} />
      <SegmentedTabs
        variant="underline-icon"
        accent="primary"
        tabs={TABS}
        value={tab}
        onChange={(id) => router.setParams({ tab: id === 'people' ? 'people' : undefined })}
      />
      <View style={styles.body}>
        {tab === 'bevs' ? <BevSearch /> : <EmptyState icon="users" title="Find people" body="Coming soon" />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
});
