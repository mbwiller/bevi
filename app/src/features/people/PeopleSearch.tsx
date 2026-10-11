import type { Page, ProfileRow } from '@bevi/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMe, useSuggested, useUserSearch } from '@/api/hooks';
import { SectionHeader } from '@/components/SectionHeader';
import { SearchBar } from '@/components/SearchBar';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { spacing } from '@/theme';

import { PeopleList, type PeopleListProps, type PeopleQuery } from './PeopleList';

/** The search field's placeholder and accessible name (DEVELOPMENT-MATT §6.8). */
export const PEOPLE_PLACEHOLDER = 'Search by name or @handle';

/** Drops the viewer's own row from every page. */
function withoutMe(data: InfiniteData<Page<ProfileRow>> | undefined, meId: string | undefined) {
  if (!data || !meId) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((r) => r.id !== meId) })) };
}

/**
 * The People tab of Add (DEVELOPMENT-MATT §6.8, §6.16: this is the Find-people screen). Outlined
 * search, debounced 250ms, over `profile.searchUsers`; while idle, "Suggested for you" from
 * `follows.suggested()`. Rows open the person's profile and carry Follow / Following pills that
 * toggle optimistically (`useFollowToggle`, rolled back on error). Your own row never shows.
 */
export function PeopleSearch() {
  const [q, setQ] = useState('');
  const typed = q.trim();
  const query = useDebouncedValue(typed);
  const me = useMe();
  const meId = me.data?.id;
  const idle = typed.length === 0;

  const suggested = useSuggested();
  const search = useUserSearch(query, { enabled: !idle && query.length > 0 });

  const suggestedQuery: PeopleQuery = useMemo(
    () => ({
      data: suggested.data
        ? { pages: [{ items: suggested.data.filter((r) => r.id !== meId), nextCursor: null }], pageParams: [undefined] }
        : undefined,
      isPending: suggested.isPending,
      isError: suggested.isError,
      error: suggested.error,
      refetch: suggested.refetch,
      isRefetching: suggested.isRefetching,
    }),
    [suggested.data, suggested.isPending, suggested.isError, suggested.error, suggested.refetch, suggested.isRefetching, meId],
  );

  const searchQuery: PeopleQuery = useMemo(
    () => ({
      data: withoutMe(search.data, meId),
      // Disabled until the debounce settles on a non-empty query: show the skeleton meanwhile.
      isPending: search.isPending,
      isError: search.isError,
      error: search.error,
      refetch: search.refetch,
      isRefetching: search.isRefetching,
      hasNextPage: search.hasNextPage,
      isFetchingNextPage: search.isFetchingNextPage,
      fetchNextPage: search.fetchNextPage,
    }),
    [
      search.data,
      search.isPending,
      search.isError,
      search.error,
      search.refetch,
      search.isRefetching,
      search.hasNextPage,
      search.isFetchingNextPage,
      search.fetchNextPage,
      meId,
    ],
  );

  const empty: PeopleListProps['empty'] = idle
    ? { icon: 'user-plus', title: 'No suggestions right now', body: 'Search by name or @handle to find friends.' }
    : { icon: 'search', title: `No one matches "${query}"`, body: 'Check the spelling, or try their @handle.' };

  return (
    <View style={styles.wrap}>
      <View style={styles.query}>
        <SearchBar variant="outlined" placeholder={PEOPLE_PLACEHOLDER} value={q} onChange={setQ} id="add-people-q" />
      </View>
      <View style={styles.body}>
        <PeopleList
          key={idle ? 'suggested' : 'search'}
          query={idle ? suggestedQuery : searchQuery}
          meId={meId}
          empty={empty}
          header={idle ? <SectionHeader title="Suggested for you" /> : null}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  query: { paddingTop: spacing.lg, paddingBottom: spacing.md, paddingHorizontal: spacing.gutter },
  body: { flex: 1 },
});
