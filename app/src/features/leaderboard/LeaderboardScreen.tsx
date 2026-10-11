import type { CategoryId } from '@bevi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe } from '@/api/hooks';
import { Header } from '@/components/Header';
import { ListScopeDropdown } from '@/components/ListScopeDropdown';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { CategorySheet } from '@/features/lists/ListSheets';
import { visibleCategories } from '@/lib/categories';
import { spacing, useTheme } from '@/theme';

import { BevBoard } from './BevBoard';
import { PeopleBoard } from './PeopleBoard';

export type LeaderboardScope = 'bevs' | 'users';

const TABS = [
  { id: 'bevs', label: 'Bevs' },
  { id: 'users', label: 'People' },
];

function parseScope(v: string | string[] | undefined): LeaderboardScope {
  return v === 'users' ? 'users' : 'bevs';
}

/**
 * Leaderboard (§6.12): Bevs · People (`?scope=bevs|users`), the Bevs board scoped by category
 * (`?category=<id>`, only categories this user may see).
 */
export function LeaderboardScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string; category?: string }>();
  const scope = parseScope(params.scope);
  const me = useMe();
  // Until the profile loads, alcohol stays hidden.
  const categories = useMemo(() => visibleCategories(me.data?.canSeeAlcohol ?? false), [me.data?.canSeeAlcohol]);
  const categoryId = categories.find((c) => c.id === params.category)?.id;
  const scopeLabel = categories.find((c) => c.id === categoryId)?.label ?? 'All';
  const [scopeOpen, setScopeOpen] = useState(false);

  // An alcoholic category in the URL under 21 is ignored, so don't load until we know who's asking.
  const waitingForAge = !!params.category && !categoryId && me.isPending;

  const scopeRow = (
    <View style={styles.scope}>
      <ListScopeDropdown label={scopeLabel} onPress={() => setScopeOpen(true)} />
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header centered title="Leaderboard" />
      <SegmentedTabs tabs={TABS} value={scope} onChange={(id) => router.setParams({ scope: id })} />
      <View style={styles.body}>
        {scope === 'bevs' ? (
          waitingForAge ? null : (
            <BevBoard key={categoryId ?? 'all'} categoryId={categoryId} header={scopeRow} />
          )
        ) : (
          <PeopleBoard />
        )}
      </View>
      <CategorySheet
        open={scopeOpen}
        categories={categories}
        value={categoryId}
        onSelect={(id: CategoryId | undefined) => router.setParams({ category: id })}
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
