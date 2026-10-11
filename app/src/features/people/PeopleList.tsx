import type { Page, ProfileRow } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import type { InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { flattenPages } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import type { IconName } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { Skeleton } from '@/components/Skeleton';
import { UserRow } from '@/components/UserRow';
import { size, spacing, useTheme } from '@/theme';

import { useFollowToggle } from './FollowButton';

/** The slice of a `useInfiniteQuery` over `Page<ProfileRow>` the list reads (`useFollowers`, `useFollowing`, `useUserSearch`). */
export interface PeopleQuery {
  data: InfiniteData<Page<ProfileRow>> | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  isRefetching?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => unknown;
}

export interface PeopleListProps {
  query: PeopleQuery;
  /** The viewer's id: their own row shows "(you)", no Follow pill, and opens the Profile tab. */
  meId: string | undefined;
  /** Shown when the query succeeded with no rows. */
  empty: { icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void };
  /** A search field above the rows that filters the loaded people by name or handle (§6.15). */
  searchable?: boolean;
  /** Extra content above the search field, scrolling with the list. */
  header?: ReactElement | null;
}

function matches(row: ProfileRow, q: string): boolean {
  return row.handle.includes(q) || row.displayName.toLowerCase().includes(q);
}

/** Skeleton rows in the UserRow shape. */
export function PeopleSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" testID="people-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton variant="circle" width={size.target} />
          <Skeleton lines={2} />
        </View>
      ))}
    </View>
  );
}

/**
 * A FlashList of people (UserRow) with Follow / Following pills that toggle optimistically, the
 * loading, error and empty states, infinite scroll on `nextCursor`, and optional in-list search.
 * Rows open the person's profile. Generic over any `Page<ProfileRow>` query, so followers,
 * following, people search and suggestions can all use it.
 */
export function PeopleList({ query, meId, empty, searchable = false, header }: PeopleListProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const toggle = useFollowToggle();
  const [q, setQ] = useState('');
  const all = useMemo(() => flattenPages(query.data), [query.data]);
  const needle = q.trim().toLowerCase().replace(/^@/, '');
  const rows = useMemo(() => (needle ? all.filter((r) => matches(r, needle)) : all), [all, needle]);

  const renderItem = useCallback(
    ({ item }: { item: ProfileRow }) => {
      const self = item.id === meId;
      return (
        <UserRow
          user={item}
          self={self}
          following={self ? undefined : item.isFollowing}
          onFollow={() => toggle(item.id, item.isFollowing)}
          onPress={() => (self ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: item.id } }))}
        />
      );
    },
    [meId, router, toggle],
  );

  const listHeader =
    header || (searchable && all.length > 0) ? (
      <View>
        {header}
        {searchable && all.length > 0 ? (
          <View style={[styles.search, { borderBottomColor: colors.border }]}>
            <SearchBar placeholder="Search" value={q} onChange={setQ} onClear={() => setQ('')} />
          </View>
        ) : null}
      </View>
    ) : null;

  const emptyBody = query.isPending ? (
    <PeopleSkeleton />
  ) : query.isError && all.length === 0 ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : all.length > 0 ? (
    <EmptyState icon="search" title={`No one matches "${q.trim()}"`} action="Clear search" onAction={() => setQ('')} />
  ) : (
    <EmptyState icon={empty.icon ?? 'users'} title={empty.title} body={empty.body} action={empty.action} onAction={empty.onAction} />
  );

  return (
    <FlashList
      data={rows}
      renderItem={renderItem}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={<>{emptyBody}</>}
      ListFooterComponent={query.isFetchingNextPage ? <PeopleSkeleton count={2} /> : <View style={styles.foot} />}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage?.();
      }}
      onEndReachedThreshold={0.5}
      refreshing={!!query.isRefetching && !query.isFetchingNextPage && !query.isPending}
      onRefresh={() => void query.refetch()}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  foot: { height: spacing.xxl },
});
