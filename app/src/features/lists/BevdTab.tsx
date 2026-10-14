import { BUCKET_ORDER, type Bucket, type CategoryId, type RankedBev, type RankingSort } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { flattenPages, useBucket, useMyRankings } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { EmptyState } from '@/components/EmptyState';
import { FilterPill } from '@/components/FilterPill';
import { IconButton } from '@/components/IconButton';
import { SortToggle } from '@/components/SortToggle';
import type { CategoryInfo } from '@/lib/categories';
import { formatShortDate } from '@/lib/time';
import { spacing } from '@/theme';

import { BevList, listStyles } from './BevList';
import { BUCKET_SHORT } from './copy';
import { BucketSheet, FilterSheet, type BucketCounts } from './ListSheets';
import { RankingActionsSheet } from './RankingActionsSheet';

const SORTS: readonly RankingSort[] = ['score', 'recent', 'name'];
const SORT_LABEL: Record<RankingSort, string> = { score: 'Score', recent: 'Recent', name: 'Name' };

/** Bucket sizes from `listBucket` (the ordered ids the placement flow uses): filter counts and global numbers. */
function useBucketCounts(): BucketCounts {
  const loved = useBucket('LOVED');
  const fine = useBucket('FINE');
  const disliked = useBucket('DISLIKED');
  return { LOVED: loved.data?.length, FINE: fine.data?.length, DISLIKED: disliked.data?.length };
}

/** "#N" across the whole list: the Bevs in better buckets, then the position in this one. */
function globalNumber(r: RankedBev, counts: BucketCounts): number | undefined {
  let offset = 0;
  for (const b of BUCKET_ORDER) {
    if (b === r.bucket) return offset + r.position + 1;
    const n = counts[b];
    if (n == null) return undefined;
    offset += n;
  }
  return undefined;
}

export interface BevdTabProps {
  categoryId: CategoryId | undefined;
  categories: readonly CategoryInfo[];
  onCategory: (id: CategoryId | undefined) => void;
  onCategoryPress: () => void;
}

/** Bev'd (§6.5): one list sorted by score, numbered globally; buckets show through bubble colour. */
export function BevdTab({ categoryId, categories, onCategory, onCategoryPress }: BevdTabProps) {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket | undefined>();
  const [sort, setSort] = useState<RankingSort>('score');
  const [sheet, setSheet] = useState<'filters' | 'bucket' | null>(null);
  const [acting, setActing] = useState<RankedBev | null>(null);

  const query = useMyRankings({ bucket, categoryId, sort });
  const rows = useMemo(() => flattenPages(query.data), [query.data]);
  const counts = useBucketCounts();
  const total = BUCKET_ORDER.every((b) => counts[b] != null)
    ? BUCKET_ORDER.reduce((s, b) => s + (counts[b] ?? 0), 0)
    : undefined;
  const filtered = !!bucket || !!categoryId;
  const category = categories.find((c) => c.id === categoryId);

  const renderItem = useCallback(
    ({ item, index }: { item: RankedBev; index: number }) => {
      const unfilteredByScore = sort === 'score' && !filtered;
      const number = globalNumber(item, counts) ?? (unfilteredByScore ? index + 1 : undefined);
      return (
        <View>
          <BevRow
            bev={item.bev}
            number={number}
            score={item.score}
            bucket={item.bucket}
            meta={`Ranked ${formatShortDate(item.createdAt)}`}
            actions={false}
            onPress={() => router.push({ pathname: '/bev/[id]', params: { id: item.bevId } })}
          />
          <IconButton
            icon="ellipsis"
            label={`More for ${item.bev.name}`}
            onPress={() => setActing(item)}
            style={styles.more}
          />
        </View>
      );
    },
    [counts, filtered, router, sort],
  );

  const header = (
    <View>
      <View style={listStyles.filters}>
        <FilterPill count={(bucket ? 1 : 0) + (categoryId ? 1 : 0)} onPress={() => setSheet('filters')} />
        <FilterPill label={bucket ? BUCKET_SHORT[bucket] : 'Bucket'} icon={null} chevron onPress={() => setSheet('bucket')} />
        <FilterPill label={category?.label ?? 'Category'} icon={null} chevron onPress={onCategoryPress} />
      </View>
      <SortToggle
        label={SORT_LABEL[sort]}
        onPress={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!)}
        onSearch={false}
      />
    </View>
  );

  const empty =
    filtered || (total ?? 0) > 0 ? (
      <EmptyState
        icon="list-filter"
        title="No Bevs match these filters"
        body="Try another bucket or category."
        action="Clear filters"
        onAction={() => {
          setBucket(undefined);
          onCategory(undefined);
        }}
      />
    ) : (
      <EmptyState
        icon="circle-plus"
        title="Add your first Bev"
        body="Rank what you drink and your list builds itself."
        action="Add a Bev"
        onAction={() => router.push('/add')}
      />
    );

  return (
    <>
      <BevList
        data={rows}
        query={query}
        renderItem={renderItem}
        keyExtractor={(r) => r.id}
        header={header}
        empty={empty}
        resetScrollKey={`${sort}|${bucket ?? ''}|${categoryId ?? ''}`}
      />
      <FilterSheet
        open={sheet === 'filters'}
        bucket={bucket}
        counts={counts}
        categories={categories}
        categoryId={categoryId}
        onBucket={setBucket}
        onCategory={onCategory}
        onClose={() => setSheet(null)}
      />
      <BucketSheet open={sheet === 'bucket'} value={bucket} counts={counts} onSelect={setBucket} onClose={() => setSheet(null)} />
      <RankingActionsSheet ranked={acting} onClose={() => setActing(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Sits in the BevRow's 44pt foot, where Rank / Want to Try go on other lists; the glyph lines up with the gutter.
  more: { position: 'absolute', right: spacing.gutter - spacing.sm, bottom: spacing.xs },
});
