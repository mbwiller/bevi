import type { ProfileRow } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { flattenPages, useMe, useSuggested, useUserSearch } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { UserRow } from '@/components/UserRow';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { isPointsRankingItem, usePointsRanking, type PointsRankingItem } from '@/features/leaderboard/PeopleBoard';
import { useBack } from '@/lib/useBack';
import { spacing, useTheme } from '@/theme';

import { PeopleSkeleton } from './PeopleList';

export const PEOPLE_PLACEHOLDER = 'Search people';
export const SUGGESTED_TITLE = 'Suggested for you';
/** Suggestions shown before "See all". */
export const SUGGESTED_PREVIEW = 3;
const SEARCH_SKELETON_ROWS = 4;

/** A row of the screen's one list: the People screen's own entries, or the points ranking's. */
type Item =
  | PointsRankingItem
  | { kind: 'suggested-header'; key: string; more: boolean }
  | { kind: 'person'; key: string; row: ProfileRow }
  | { kind: 'loading'; key: string; count: number; label: string }
  | { kind: 'error'; key: string; error: unknown; retry: () => void }
  | { kind: 'no-match'; key: string; query: string };

const keyOf = (i: Item) => i.key;
const typeOf = (i: Item) => i.kind;

/**
 * People (`/people`, TASKS.md M-32; design system ScreenPeople): finding people and the points ranking, in one list. A back header,
 * then a filled "Search people" bar. Idle: "Suggested for you" (`follows.suggested`, the first few
 * with "See all") and then the points ranking (`usePointsRanking`: "Ranked by points", the "How
 * points work" sheet, your own row tinted and pinned under the list while it's off screen). Typing
 * replaces both with people search results (debounced, as the Search screen's). Your own profile is
 * never suggested or found. Follow toggles optimistically everywhere; every row opens the person.
 */
export function FindPeopleScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const me = useMe();
  const meId = me.data?.id;

  const [q, setQ] = useState('');
  const typed = q.trim();
  const query = useDebouncedValue(typed);
  const searching = typed.length > 0;
  const settled = searching && query === typed;

  const ranking = usePointsRanking({ active: !searching });
  const { toggleFollow, renderItem: renderRanking } = ranking;

  const suggested = useSuggested();
  const people = useUserSearch(query, { enabled: searching && query.length > 0 });
  const [allSuggested, setAllSuggested] = useState(false);

  const suggestions = useMemo(() => (suggested.data ?? []).filter((r) => r.id !== meId), [suggested.data, meId]);
  const results = useMemo(() => flattenPages(people.data).filter((r) => r.id !== meId), [people.data, meId]);

  const { error: suggestedError, refetch: refetchSuggested } = suggested;
  const { error: peopleError, refetch: refetchPeople } = people;
  const suggestedFailed = suggested.isError && !suggested.data;
  const peopleFailed = people.isError && !people.data;

  const items = useMemo<Item[]>(() => {
    if (searching) {
      // Still debouncing, or waiting for the first answer to this query.
      if (!settled || people.isPending) {
        return [{ kind: 'loading', key: 'search-loading', count: SEARCH_SKELETON_ROWS, label: 'Loading people' }];
      }
      if (peopleFailed) return [{ kind: 'error', key: 'search-error', error: peopleError, retry: () => void refetchPeople() }];
      if (results.length === 0) return [{ kind: 'no-match', key: 'no-match', query }];
      return results.map((row): Item => ({ kind: 'person', key: `p:${row.id}`, row }));
    }
    const out: Item[] = [];
    const more = !allSuggested && suggestions.length > SUGGESTED_PREVIEW;
    if (suggested.isPending) {
      out.push(
        { kind: 'suggested-header', key: 'suggested-header', more: false },
        { kind: 'loading', key: 'suggested-loading', count: 2, label: 'Loading suggestions' },
      );
    } else if (suggestedFailed) {
      out.push(
        { kind: 'suggested-header', key: 'suggested-header', more: false },
        { kind: 'error', key: 'suggested-error', error: suggestedError, retry: () => void refetchSuggested() },
      );
    } else if (suggestions.length > 0) {
      // Left out when there's no one left to suggest.
      out.push({ kind: 'suggested-header', key: 'suggested-header', more });
      const shown = more ? suggestions.slice(0, SUGGESTED_PREVIEW) : suggestions;
      for (const row of shown) out.push({ kind: 'person', key: `s:${row.id}`, row });
    }
    return [...out, ...ranking.items];
  }, [
    searching,
    settled,
    people.isPending,
    peopleFailed,
    peopleError,
    refetchPeople,
    results,
    query,
    allSuggested,
    suggestions,
    suggested.isPending,
    suggestedFailed,
    suggestedError,
    refetchSuggested,
    ranking.items,
  ]);

  const openUser = useCallback((id: string) => router.push({ pathname: '/user/[id]', params: { id } }), [router]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (isPointsRankingItem(item)) return renderRanking(item);
      switch (item.kind) {
        case 'suggested-header':
          return (
            <SectionHeader
              title={SUGGESTED_TITLE}
              action={item.more ? 'See all' : undefined}
              actionLabel="See all suggestions"
              onAction={() => setAllSuggested(true)}
            />
          );
        case 'person':
          return (
            <UserRow
              user={item.row}
              following={item.row.isFollowing}
              onFollow={() => toggleFollow(item.row.id, item.row.isFollowing)}
              onPress={() => openUser(item.row.id)}
            />
          );
        case 'loading':
          return (
            <View accessibilityLabel={item.label} aria-busy>
              <PeopleSkeleton count={item.count} />
            </View>
          );
        case 'error':
          return <ErrorState error={item.error} onRetry={item.retry} />;
        case 'no-match':
          return <EmptyState icon="search" title={`No one matches "${item.query}"`} body="Check the spelling, or search by @handle." />;
      }
    },
    [renderRanking, toggleFollow, openUser],
  );

  const onEndReached = () => {
    if (!searching) ranking.loadMore();
    else if (people.hasNextPage && !people.isFetchingNextPage) void people.fetchNextPage();
  };
  const footer = searching ? (
    people.isFetchingNextPage ? (
      <PeopleSkeleton count={2} />
    ) : (
      <View style={styles.foot} />
    )
  ) : (
    ranking.footer
  );
  const refreshing = searching
    ? people.isRefetching && !people.isFetchingNextPage && !people.isPending
    : ranking.refreshing || (suggested.isRefetching && !suggested.isPending);
  const onRefresh = () => {
    if (searching) {
      void refetchPeople();
      return;
    }
    void refetchSuggested();
    ranking.refresh();
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="People" onBack={back} />
      <View style={styles.query}>
        <SearchBar variant="filled" placeholder={PEOPLE_PLACEHOLDER} value={q} onChange={setQ} onClear={() => setQ('')} id="people-q" />
      </View>
      <View style={styles.body}>
        <FlashList
          testID="people-list"
          data={items}
          renderItem={renderItem}
          keyExtractor={keyOf}
          getItemType={typeOf}
          ListFooterComponent={footer}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          viewabilityConfig={ranking.viewabilityConfig}
          onViewableItemsChanged={ranking.onViewableItemsChanged}
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
        {ranking.pinned}
      </View>
      {ranking.sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  query: { paddingTop: spacing.xs, paddingBottom: spacing.xs, paddingHorizontal: spacing.gutter },
  body: { flex: 1 },
  foot: { height: spacing.xxl },
});
