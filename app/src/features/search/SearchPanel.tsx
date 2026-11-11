import type { BevSummary, ProfileRow } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { flattenPages, useBevSearch, useMe, useUserSearch } from '@/api/hooks';
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
import { footLift, keyboardTop } from './keyboardLift';
import { bevQueryFor, searchMode } from './panel';
import { usePopularBevs } from './popular';

export const ADD_NEW = "Can't find it? Add a new Bev";
export const POPULAR_TITLE = 'Popular on Bevi';
const SKELETON_ROWS = 4;
const POPULAR_SKELETON_ROWS = 3;

type Group = 'bevs' | 'people' | 'popular';

interface HeaderAction {
  label: string;
  onPress: () => void;
}

type Item =
  | { kind: 'header'; key: string; title: string; action?: HeaderAction }
  | { kind: 'recent'; key: string; bev: RecentBev }
  | { kind: 'bev'; key: string; bev: BevSummary }
  | { kind: 'person'; key: string; row: ProfileRow }
  | { kind: 'loading'; key: string; group: Group }
  | { kind: 'error'; key: string; error: unknown; retry: () => void };

const header = (title: string, action?: HeaderAction): Item => ({ kind: 'header', key: `h:${title}`, title, action });

export interface SearchPanelProps {
  /** The bar's text as typed. */
  q: string;
  /** The bar's text, trimmed and debounced 250ms by the screen. */
  query: string;
}

/**
 * The Add Bev screen's results list (design system ScreenSearchResults), the body of the screen.
 * Idle (an empty bar): Recents, then "Popular on Bevi", the most popular Bevs you haven't ranked,
 * with "See all" opening Lists' Top tab. Typing searches Bevs and people at once; results are
 * grouped under "Bevs" (BevRows: tap to rank, or to open one you've ranked; plus to rank; bookmark
 * for Want to Try) and "People" (UserRows with Follow, which toggles optimistically). A query
 * starting with "@" is a handle, so it searches people only. A group or section holds its place
 * while it loads, shows its own error with Retry, and is left out when it has nothing. A sticky
 * "Can't find it? Add a new Bev" closes the bottom, kept above the keyboard, and turns primary when
 * no Bev matches. Your own profile never shows.
 */
export function SearchPanel({ q, query }: SearchPanelProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const typed = q.trim();
  const idle = searchMode(q) === 'idle';
  const settled = !idle && query === typed;
  const bevQuery = bevQueryFor(query);

  const me = useMe();
  const meId = me.data?.id;
  const canSeeAlcohol = me.data?.canSeeAlcohol ?? false;
  const { recents, remember, forget } = useRecents(meId);
  const { open, rank } = useOpenBev(remember);
  const toggle = useFollowToggle();

  const popular = usePopularBevs(canSeeAlcohol);
  const bevs = useBevSearch(bevQuery, undefined, { enabled: !idle && bevQuery.length > 0 });
  const people = useUserSearch(query, { enabled: !idle && query.length > 0 });

  // The server already age-filters; this keeps the alcoholic three out even if a result slips through.
  const allowed = useMemo(() => new Set(visibleCategories(canSeeAlcohol).map((c) => c.id)), [canSeeAlcohol]);
  const bevResults = useMemo(
    () => (bevQuery ? (bevs.data?.items ?? []).filter((b) => allowed.has(b.categoryId)) : []),
    [bevQuery, bevs.data, allowed],
  );
  const peopleResults = useMemo(() => flattenPages(people.data).filter((r) => r.id !== meId), [people.data, meId]);

  const searching = !idle && query.length > 0;
  const bevFailed = searching && bevQuery.length > 0 && bevs.isError && !bevs.data;
  const peopleFailed = searching && people.isError && !people.data;
  const popularFailed = popular.query.isError && !popular.query.data;
  // A group still waiting for its first answer to this query holds its place.
  const bevLoading = searching && bevQuery.length > 0 && !bevFailed && bevResults.length === 0 && (!bevs.data || bevs.isPlaceholderData);
  const peopleLoading = searching && !peopleFailed && !people.data;
  const popularLoading = !popularFailed && popular.query.isPending;
  const noBev = settled && bevQuery.length > 0 && bevs.isSuccess && !bevs.isPlaceholderData && bevResults.length === 0;

  const seeAll = useCallback(() => router.push({ pathname: '/lists', params: { tab: 'top' } }), [router]);

  const items = useMemo<Item[]>(() => {
    if (idle) {
      const out: Item[] = recents.length
        ? [header('Recents'), ...recents.map((bev): Item => ({ kind: 'recent', key: `r:${bev.id}`, bev }))]
        : [];
      const top = header(POPULAR_TITLE, { label: 'See all', onPress: seeAll });
      if (popularFailed) out.push(top, { kind: 'error', key: 'e:popular', error: popular.query.error, retry: () => void popular.query.refetch() });
      else if (popular.bevs.length) out.push(top, ...popular.bevs.map((bev): Item => ({ kind: 'bev', key: `pop:${bev.id}`, bev })));
      else if (popularLoading) out.push(top, { kind: 'loading', key: 'l:popular', group: 'popular' });
      return out;
    }
    const out: Item[] = [];
    if (bevFailed) out.push(header('Bevs'), { kind: 'error', key: 'e:bevs', error: bevs.error, retry: () => void bevs.refetch() });
    else if (bevResults.length) out.push(header('Bevs'), ...bevResults.map((bev): Item => ({ kind: 'bev', key: `b:${bev.id}`, bev })));
    else if (bevLoading) out.push(header('Bevs'), { kind: 'loading', key: 'l:bevs', group: 'bevs' });
    if (peopleFailed) out.push(header('People'), { kind: 'error', key: 'e:people', error: people.error, retry: () => void people.refetch() });
    else if (peopleResults.length) out.push(header('People'), ...peopleResults.map((row): Item => ({ kind: 'person', key: `p:${row.id}`, row })));
    else if (peopleLoading) out.push(header('People'), { kind: 'loading', key: 'l:people', group: 'people' });
    return out;
    // The query objects change identity every render; their error and refetch are what's read.
  }, [
    idle,
    recents,
    seeAll,
    popularFailed,
    popular.bevs,
    popularLoading,
    popular.query.error,
    popular.query.refetch,
    bevFailed,
    bevResults,
    bevLoading,
    bevs.error,
    bevs.refetch,
    peopleFailed,
    peopleResults,
    peopleLoading,
    people.error,
    people.refetch,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.kind) {
        case 'header':
          return <SectionHeader title={item.title} action={item.action?.label} onAction={item.action?.onPress} />;
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
        case 'loading':
          return item.group === 'people' ? (
            <PeopleSkeleton count={1} />
          ) : (
            <View accessibilityLabel={item.group === 'popular' ? 'Loading popular Bevs' : 'Loading Bevs'} aria-busy>
              {Array.from({ length: item.group === 'popular' ? POPULAR_SKELETON_ROWS : 1 }, (_, i) => (
                <Skeleton key={i} variant="row" />
              ))}
            </View>
          );
        case 'error':
          return <ErrorState error={item.error} onRetry={item.retry} />;
      }
    },
    [open, rank, forget, toggle, router],
  );

  let body;
  if (items.length) {
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
    body = <EmptyState icon="search" title="Find a Bev or a friend" body="Search Bevs by name, brand or flavor, and people by name or @handle." />;
  } else if (!settled) {
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
 * How far to raise the list's foot so the keyboard never covers it. The list ends above the tab
 * bar, so only the part of the keyboard taller than what lies below the list hides anything:
 * measure the list's bottom in the window, then compare it with the keyboard's top
 * (`keyboardLift.ts`, which explains why the web reads `window.innerHeight`).
 */
function useKeyboardLift() {
  const inset = useKeyboardInset();
  const { height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  const measure = useCallback(() => {
    ref.current?.measureInWindow?.((_x, y, _w, h) => setBottom(y + h));
  }, []);
  // Opening the keyboard can pan the page: measure again whenever the inset changes.
  useEffect(() => {
    if (inset > 0) measure();
  }, [inset, measure]);
  const layoutHeight = Platform.OS === 'web' && typeof window !== 'undefined' ? window.innerHeight : height;
  const by = inset > 0 && bottom != null ? footLift(bottom, keyboardTop(layoutHeight, inset)) : 0;
  return { ref, measure, by };
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1 },
  foot: { paddingVertical: spacing.md, paddingHorizontal: spacing.gutter, borderTopWidth: 1 },
});
