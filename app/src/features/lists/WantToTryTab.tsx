import type { CategoryId, WantToTryItem } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { flattenPages, useRemoveWantToTry, useWantToTry } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { EmptyState } from '@/components/EmptyState';
import { FilterPill } from '@/components/FilterPill';
import type { CategoryInfo } from '@/lib/categories';
import { formatShortDate } from '@/lib/time';

import { BevList, listStyles } from './BevList';
import { FilterSheet } from './ListSheets';

export interface WantToTryTabProps {
  categoryId: CategoryId | undefined;
  categories: readonly CategoryInfo[];
  onCategory: (id: CategoryId | undefined) => void;
  onCategoryPress: () => void;
}

/** "Saved from @arjun", else "Saved Oct 3". */
function savedMeta(item: WantToTryItem): string {
  return item.via ? `Saved from @${item.via.handle}` : `Saved ${formatShortDate(item.savedAt)}`;
}

/**
 * Want to Try (§6.6): the global Bayesian score, a filled bookmark that unsaves
 * optimistically, and Rank it. `wantToTry.list` has no category filter, so the scope filters the
 * loaded pages.
 */
export function WantToTryTab({ categoryId, categories, onCategory, onCategoryPress }: WantToTryTabProps) {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useWantToTry();
  const remove = useRemoveWantToTry();
  const all = useMemo(() => flattenPages(query.data), [query.data]);
  const visible = useMemo(() => {
    const allowed = new Set(categories.map((c) => c.id));
    return all.filter((w) => allowed.has(w.bev.categoryId) && (!categoryId || w.bev.categoryId === categoryId));
  }, [all, categories, categoryId]);
  const category = categories.find((c) => c.id === categoryId);

  const renderItem = useCallback(
    ({ item }: { item: WantToTryItem }) => (
      <BevRow
        bev={item.bev}
        score={item.bev.bayesScore}
        meta={savedMeta(item)}
        saved
        onSave={() => remove.mutate(item.bev.id)}
        onRank={() => router.push({ pathname: '/rank/[bevId]', params: { bevId: item.bev.id } })}
        onPress={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
      />
    ),
    [remove, router],
  );

  const header = (
    <View style={listStyles.filters}>
      <FilterPill count={categoryId ? 1 : 0} onPress={() => setFiltersOpen(true)} />
      <FilterPill label={category?.label ?? 'Category'} icon={null} chevron onPress={onCategoryPress} />
    </View>
  );

  const empty =
    categoryId && all.length > 0 ? (
      <EmptyState
        icon="list-filter"
        title="No Bevs match these filters"
        body="Try another category."
        action="Clear filters"
        onAction={() => onCategory(undefined)}
      />
    ) : (
      <EmptyState
        icon="bookmark"
        title="Nothing saved yet"
        body="Bookmark Bevs from the Feed, Leaderboard or a friend's profile."
      />
    );

  return (
    <>
      <BevList data={visible} query={query} renderItem={renderItem} keyExtractor={(w) => w.bev.id} header={header} empty={empty} />
      <FilterSheet
        open={filtersOpen}
        categories={categories}
        categoryId={categoryId}
        onCategory={onCategory}
        onClose={() => setFiltersOpen(false)}
      />
    </>
  );
}
