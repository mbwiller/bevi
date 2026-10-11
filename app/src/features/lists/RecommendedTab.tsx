import { MIN_N_USER } from '@bevi/ranking';
import type { CategoryId, Recommendation } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { flattenPages, useAddWantToTry, useRecommendations, useRemoveWantToTry, useWantToTry } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { EmptyState } from '@/components/EmptyState';
import { FilterPill } from '@/components/FilterPill';
import { SortToggle } from '@/components/SortToggle';
import type { CategoryInfo } from '@/lib/categories';
import { formatRelativeTime } from '@/lib/time';
import { MAX_FONT_SCALE_DENSE, type, useTheme } from '@/theme';

import { BevList, listStyles } from './BevList';
import { bevCount, MIN_CONFIDENCE, reasonText, RECS_LOCKED_TITLE } from './copy';
import { FilterSheet } from './ListSheets';

export interface RecommendedTabProps {
  categoryId: CategoryId | undefined;
  categories: readonly CategoryInfo[];
  onCategory: (id: CategoryId | undefined) => void;
  onCategoryPress: () => void;
}

/** "Based on 12 Bevs you've ranked · Updated 2 hours ago". */
export function basedOnLine(basedOnCount: number, generatedAt: string, now?: Date): string {
  return `Based on ${bevCount(basedOnCount)} you've ranked · Updated ${formatRelativeTime(generatedAt, now).replace(/^Just now$/, 'just now')}`;
}

/**
 * Recommended (§6.7): predicted bubbles (locked below `MIN_CONFIDENCE`), the reason in the meta
 * line, Rank it and Want to Try. Locked below `MIN_N_USER` rankings. The result has no category
 * filter or saved flag, so the scope filters client-side and "saved" comes from the loaded Want to Try.
 */
export function RecommendedTab({ categoryId, categories, onCategory, onCategoryPress }: RecommendedTabProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useRecommendations();
  const want = useWantToTry();
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();

  const savedIds = useMemo(() => new Set(flattenPages(want.data).map((w) => w.bev.id)), [want.data]);
  const result = query.data;
  const locked = !!result && result.basedOnCount < MIN_N_USER;
  const items = useMemo(() => {
    const allowed = new Set(categories.map((c) => c.id));
    return (result?.items ?? []).filter((r) => allowed.has(r.bev.categoryId) && (!categoryId || r.bev.categoryId === categoryId));
  }, [result, categories, categoryId]);
  const category = categories.find((c) => c.id === categoryId);

  const renderItem = useCallback(
    ({ item }: { item: Recommendation }) => {
      const saved = savedIds.has(item.bev.id);
      return (
        <BevRow
          bev={item.bev}
          score={item.predictedScore}
          scoreVariant={item.confidence < MIN_CONFIDENCE ? 'locked' : 'predicted'}
          count={item.bev.ratingCount}
          meta={reasonText(item)}
          saved={saved}
          onSave={() => (saved ? remove.mutate(item.bev.id) : add.mutate({ bevId: item.bev.id }))}
          onRank={() => router.push({ pathname: '/rank/[bevId]', params: { bevId: item.bev.id } })}
          onPress={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
        />
      );
    },
    [add, remove, router, savedIds],
  );

  const header = locked ? null : (
    <View>
      {result ? (
        <Text
          style={[type.body, listStyles.summary, { color: colors.textSecondary }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
        >
          {basedOnLine(result.basedOnCount, result.generatedAt)}
        </Text>
      ) : null}
      <View style={listStyles.filters}>
        <FilterPill count={categoryId ? 1 : 0} onPress={() => setFiltersOpen(true)} />
        <FilterPill label={category?.label ?? 'Category'} icon={null} chevron onPress={onCategoryPress} />
      </View>
      <SortToggle label="Predicted" onSearch={false} />
    </View>
  );

  const remaining = result ? Math.max(0, MIN_N_USER - result.basedOnCount) : MIN_N_USER;
  const empty = locked ? (
    <EmptyState
      icon="lock"
      title={RECS_LOCKED_TITLE}
      body={`${remaining} more to go. Your picks get sharper with every Bev you rank.`}
      action="Add a Bev"
      onAction={() => router.push('/add')}
    />
  ) : categoryId && (result?.items.length ?? 0) > 0 ? (
    <EmptyState
      icon="list-filter"
      title="No Bevs match these filters"
      body="Try another category."
      action="Clear filters"
      onAction={() => onCategory(undefined)}
    />
  ) : (
    <EmptyState icon="heart" title="No recommendations yet" body="Rank a few more Bevs and check back." />
  );

  return (
    <>
      <BevList
        data={locked ? [] : items}
        query={query}
        renderItem={renderItem}
        keyExtractor={(r) => r.bev.id}
        header={header}
        empty={empty}
      />
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
