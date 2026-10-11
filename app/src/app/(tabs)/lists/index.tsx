import type { CategoryId } from '@bevi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe } from '@/api/hooks';
import { Header } from '@/components/Header';
import { ListScopeDropdown } from '@/components/ListScopeDropdown';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { BevdTab } from '@/features/lists/BevdTab';
import { CategorySheet } from '@/features/lists/ListSheets';
import { RecommendedTab } from '@/features/lists/RecommendedTab';
import { WantToTryTab } from '@/features/lists/WantToTryTab';
import { visibleCategories } from '@/lib/categories';
import { spacing, useTheme } from '@/theme';

export type ListsTab = 'bevd' | 'want' | 'recommended';

const TABS = [
  { id: 'bevd', label: "Bev'd" },
  { id: 'want', label: 'Want to Try' },
  { id: 'recommended', label: 'Recommended' },
] as const;

function parseTab(v: string | string[] | undefined): ListsTab {
  return v === 'want' || v === 'recommended' ? v : 'bevd';
}

/** Your Lists (§6.5–§6.7): Bev'd, Want to Try and Recommended, scoped by category. `?tab=` picks the tab. */
export default function ListsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = parseTab(params.tab);
  const me = useMe();
  // Until the profile loads, alcohol stays hidden.
  const categories = useMemo(() => visibleCategories(me.data?.canSeeAlcohol ?? false), [me.data?.canSeeAlcohol]);
  const [picked, setPicked] = useState<CategoryId | undefined>();
  const [scopeOpen, setScopeOpen] = useState(false);
  const categoryId = categories.some((c) => c.id === picked) ? picked : undefined;
  const scopeLabel = categories.find((c) => c.id === categoryId)?.label ?? 'All';

  const tabProps = { categoryId, categories, onCategory: setPicked, onCategoryPress: () => setScopeOpen(true) };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header centered title="Your lists" />
      <View style={styles.scope}>
        <ListScopeDropdown label={scopeLabel} onPress={() => setScopeOpen(true)} />
      </View>
      <SegmentedTabs tabs={[...TABS]} value={tab} onChange={(id) => router.setParams({ tab: id })} />
      <View style={styles.body}>
        {tab === 'bevd' ? <BevdTab {...tabProps} /> : null}
        {tab === 'want' ? <WantToTryTab {...tabProps} /> : null}
        {tab === 'recommended' ? <RecommendedTab {...tabProps} /> : null}
      </View>
      <CategorySheet
        open={scopeOpen}
        categories={categories}
        value={categoryId}
        onSelect={setPicked}
        onClose={() => setScopeOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scope: { paddingHorizontal: spacing.gutter },
  body: { flex: 1 },
});
