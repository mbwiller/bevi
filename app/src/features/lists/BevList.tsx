import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { spacing } from '@/theme';

/** Rows of skeleton in the BevRow shape: the list's loading state. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" testID="list-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="row" />
      ))}
    </View>
  );
}

/** The slice of a TanStack query a list screen reads. */
export interface ListQueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  isRefetching?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => unknown;
}

export interface BevListProps<T> {
  data: readonly T[];
  query: ListQueryState;
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T) => string;
  /** Filter row, sort, summary line: scrolls with the list. */
  header?: ReactElement | null;
  /** Shown when the query succeeded with no rows. */
  empty: ReactNode;
  /** When this changes (sort or filters), the list scrolls back to the top. Not on first mount. */
  resetScrollKey?: string;
}

/**
 * A FlashList of Bev rows with the common states: skeleton while loading, ErrorState with Retry,
 * an empty state, infinite scroll on `nextCursor` and pull-to-refresh (native only; harmless on web).
 * Maintain-visible-content-position is off: these lists are top-anchored and append at the bottom, and
 * with it on, a re-sort scrolls to wherever the old first row landed. `resetScrollKey` returns to the top.
 */
export function BevList<T>({ data, query, renderItem, keyExtractor, header, empty, resetScrollKey }: BevListProps<T>) {
  const listRef = useRef<FlashListRef<T>>(null);
  const lastKey = useRef(resetScrollKey);
  useEffect(() => {
    if (lastKey.current === resetScrollKey) return;
    lastKey.current = resetScrollKey;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [resetScrollKey]);
  const body = query.isPending ? (
    <SkeletonRows />
  ) : query.isError && data.length === 0 ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    empty
  );
  return (
    <FlashList
      ref={listRef}
      maintainVisibleContentPosition={{ disabled: true }}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={header}
      ListEmptyComponent={<>{body}</>}
      ListFooterComponent={query.isFetchingNextPage ? <SkeletonRows count={2} /> : <View style={styles.foot} />}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage?.();
      }}
      onEndReachedThreshold={0.5}
      refreshing={!!query.isRefetching && !query.isFetchingNextPage && !query.isPending}
      onRefresh={() => void query.refetch()}
    />
  );
}

const styles = StyleSheet.create({ foot: { height: spacing.xxl } });

/** Shared by the three tabs' list headers. */
export const listStyles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  summary: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.xs },
});
