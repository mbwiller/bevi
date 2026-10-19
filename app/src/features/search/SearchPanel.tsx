import type { BevSummary, ProfileRow } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { flattenPages, useBevSearch, useMe, useSuggested, useUserSearch } from '@/api/hooks';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { UserRow } from '@/components/UserRow';
import { useRecents, type RecentBev } from '@/features/add-bev/recents';
import { useFollowToggle } from '@/features/people/FollowButton';
import { PeopleSkeleton } from '@/features/people/PeopleList';
import { visibleCategories } from '@/lib/categories';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { spacing, useTheme } from '@/theme';

import { RecentRow, ResultRow, useOpenBev } from './BevRows';

export const ADD_NEW = "Can't find it? Add a new Bev";
const SKELETON_ROWS = 4;

type Item =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'recent'; key: string; bev: RecentBev }
  | { kind: 'bev'; key: string; bev: BevSummary }
  | { kind: 'person'; key: string; row: ProfileRow };

const header = (title: string): Item => ({ kind: 'header', key: `h:${title}`, title });

/**
 * The Search tab's results panel (design system ScreenSearchResults), over the map area. One query
 * (`query`, the bar's text debounced 250ms by the screen) searches Bevs and people; results are grouped under "Bevs" (BevRows: tap to
 * rank, or to open one you've ranked; plus to rank; bookmark for Want to Try) and "People"
 * (UserRows with Follow, which toggles optimistically). A query starting with "@" is a handle, so
 * it searches people only. An empty group is left out. Idle: Recents and "Suggested for you".
 * A sticky "Can't find it? Add a new Bev" closes the bottom, kept above the keyboard, and turns
 * primary when no Bev matches. Your own profile never shows.
 */
export function SearchPanel({ q, query }: { q: string; query: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const typed = q.trim();
  const idle = typed.length === 0;
  const settled = !idle && query === typed;
  const bevQuery = query.startsWith('@') ? '' : query;

  const me = useMe();
  const meId = me.data?.id;
  const { recents, remember, forget } = useRecents(meId);
  const { open, rank } = useOpenBev(remember);
  const toggle = useFollowToggle();

  const suggested = useSuggested();
  const bevs = useBevSearch(bevQuery, undefined, { enabled: !idle && bevQuery.length > 0 });
  const people = useUserSearch(query, { enabled: !idle && query.length > 0 });

  // The server already age-filters; this keeps the alcoholic three out even if a result slips through.
  const allowed = useMemo(() => new Set(visibleCategories(me.data?.canSeeAlcohol ?? false).map((c) => c.id)), [me.data?.canSeeAlcohol]);
  const bevResults = useMemo(
    () => (bevQuery ? (bevs.data?.items ?? []).filter((b) => allowed.has(b.categoryId)) : []),
    [bevQuery, bevs.data, allowed],
  );
  const peopleResults = useMemo(() => flattenPages(people.data).filter((r) => r.id !== meId), [people.data, meId]);
  const suggestions = useMemo(() => (suggested.data ?? []).filter((r) => r.id !== meId), [suggested.data, meId]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (idle) {
      if (recents.length) out.push(header('Recents'), ...recents.map((bev): Item => ({ kind: 'recent', key: `r:${bev.id}`, bev })));
      if (suggestions.length) out.push(header('Suggested for you'), ...suggestions.map((row): Item => ({ kind: 'person', key: `s:${row.id}`, row })));
    } else {
      if (bevResults.length) out.push(header('Bevs'), ...bevResults.map((bev): Item => ({ kind: 'bev', key: `b:${bev.id}`, bev })));
      if (peopleResults.length) out.push(header('People'), ...peopleResults.map((row): Item => ({ kind: 'person', key: `p:${row.id}`, row })));
    }
    return out;
  }, [idle, recents, suggestions, bevResults, peopleResults]);

  const bevFailed = bevQuery.length > 0 && bevs.isError && !bevs.data;
  const peopleFailed = people.isError && !people.data;
  const bevPending = bevQuery.length > 0 && !bevs.data;
  const noBev = settled && bevQuery.length > 0 && bevs.isSuccess && !bevs.isPlaceholderData && bevResults.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.kind) {
        case 'header':
          return <SectionHeader title={item.title} />;
        case 'recent':
          return <RecentRow bev={item.bev} onPress={() => open(item.bev)} onForget={() => forget(item.bev.id)} />;
        case 'bev':
          return <ResultRow bev={item.bev} onOpen={(ranked) => open(item.bev, ranked)} onRank={() => rank(item.bev)} />;
        case 'person':
          return (
            <UserRow
              user={item.row}
              following={item.row.isFollowing}
              onFollow={() => toggle(item.row.id, item.row.isFollowing)}
              onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.row.id } })}
            />
          );
      }
    },
    [open, rank, forget, toggle, router],
  );

  let body;
  if (!idle && (bevFailed || peopleFailed)) {
    body = (
      <ErrorState
        error={bevFailed ? bevs.error : people.error}
        onRetry={() => {
          if (bevFailed) void bevs.refetch();
          if (peopleFailed) void people.refetch();
        }}
      />
    );
  } else if (items.length) {
    body = (
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(i) => i.key}
        getItemType={(i) => i.kind}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => {
          if (!idle && people.hasNextPage && !people.isFetchingNextPage) void people.fetchNextPage();
        }}
      />
    );
  } else if (idle) {
    body = suggested.isPending ? (
      <PeopleSkeleton count={SKELETON_ROWS} />
    ) : (
      <EmptyState icon="search" title="Find a Bev or a friend" body="Search Bevs by name, brand or flavor, and people by name or @handle." />
    );
  } else if (!settled || bevPending || !people.data) {
    body = (
      <View accessibilityLabel="Loading results" aria-busy>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} variant="row" />
        ))}
      </View>
    );
  } else {
    body = <EmptyState icon="search" title={`No Bevs or people match "${query}"`} body="Check the spelling, or add the Bev to Bevi." />;
  }

  const lift = useKeyboardLift();

  return (
    <View ref={lift.ref} onLayout={lift.measure} style={styles.wrap}>
      <View style={styles.body}>{body}</View>
      <View style={[styles.foot, { borderTopColor: colors.border, backgroundColor: colors.surface, marginBottom: lift.by }]}>
        <Button variant={noBev ? 'primary' : 'outlined'} block icon="circle-plus" onPress={() => router.push('/add/new')}>
          {ADD_NEW}
        </Button>
      </View>
    </View>
  );
}

/**
 * How far to raise the panel's foot so the keyboard never covers it. The panel ends above the tab
 * bar, so only the part of the keyboard taller than what lies below the panel hides anything:
 * measure the panel's bottom in the window, then compare it with the top of the keyboard.
 */
function useKeyboardLift() {
  const inset = useKeyboardInset();
  const { height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  const measure = useCallback(() => {
    ref.current?.measureInWindow?.((_x, y, _w, h) => setBottom(y + h));
  }, []);
  const by = inset > 0 && bottom != null ? Math.max(0, bottom - (height - inset)) : 0;
  return { ref, measure, by };
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1 },
  foot: { paddingVertical: spacing.md, paddingHorizontal: spacing.gutter, borderTopWidth: 1 },
});
