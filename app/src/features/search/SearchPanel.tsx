import type { BevSummary, ProfileRow } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

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
import { footLift, keyboardTop } from './keyboardLift';

export const ADD_NEW = "Can't find it? Add a new Bev";
const SKELETON_ROWS = 4;

type Group = 'bevs' | 'people';

type Item =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'recent'; key: string; bev: RecentBev }
  | { kind: 'bev'; key: string; bev: BevSummary }
  | { kind: 'person'; key: string; row: ProfileRow }
  | { kind: 'loading'; key: string; group: Group }
  | { kind: 'error'; key: string; error: unknown; retry: () => void };

const header = (title: string): Item => ({ kind: 'header', key: `h:${title}`, title });

export interface SearchPanelProps {
  /** The bar's text as typed. */
  q: string;
  /** The bar's text, trimmed and debounced 250ms by the screen. */
  query: string;
  /** Idle: "Suggested for you" above Recents (the panel was opened by Find people). */
  suggestionsFirst?: boolean;
}

/**
 * The Search tab's results panel (design system ScreenSearchResults), over the map area. One query
 * searches Bevs and people; results are grouped under "Bevs" (BevRows: tap to rank, or to open one
 * you've ranked; plus to rank; bookmark for Want to Try) and "People" (UserRows with Follow, which
 * toggles optimistically). A query starting with "@" is a handle, so it searches people only. A
 * group holds its place while it loads, shows its own error with Retry, and is left out when it has
 * nothing. Idle: Recents and "Suggested for you". A sticky "Can't find it? Add a new Bev" closes
 * the bottom, kept above the keyboard, and turns primary when no Bev matches. Your own profile
 * never shows.
 */
export function SearchPanel({ q, query, suggestionsFirst = false }: SearchPanelProps) {
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

  const searching = !idle && query.length > 0;
  const bevFailed = searching && bevQuery.length > 0 && bevs.isError && !bevs.data;
  const peopleFailed = searching && people.isError && !people.data;
  const suggestedFailed = suggested.isError && !suggested.data;
  // A group still waiting for its first answer to this query holds its place.
  const bevLoading = searching && bevQuery.length > 0 && !bevFailed && bevResults.length === 0 && (!bevs.data || bevs.isPlaceholderData);
  const peopleLoading = searching && !peopleFailed && !people.data;
  const noBev = settled && bevQuery.length > 0 && bevs.isSuccess && !bevs.isPlaceholderData && bevResults.length === 0;

  const items = useMemo<Item[]>(() => {
    if (idle) {
      const recent: Item[] = recents.length
        ? [header('Recents'), ...recents.map((bev): Item => ({ kind: 'recent', key: `r:${bev.id}`, bev }))]
        : [];
      const suggest: Item[] = suggestedFailed
        ? [header('Suggested for you'), { kind: 'error', key: 'e:suggested', error: suggested.error, retry: () => void suggested.refetch() }]
        : suggestions.length
          ? [header('Suggested for you'), ...suggestions.map((row): Item => ({ kind: 'person', key: `s:${row.id}`, row }))]
          : [];
      return suggestionsFirst ? [...suggest, ...recent] : [...recent, ...suggest];
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
    suggestions,
    suggestionsFirst,
    suggestedFailed,
    suggested.error,
    suggested.refetch,
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
        case 'loading':
          return item.group === 'bevs' ? (
            <View accessibilityLabel="Loading Bevs" aria-busy>
              <Skeleton variant="row" />
            </View>
          ) : (
            <PeopleSkeleton count={1} />
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
    body = suggested.isPending ? (
      <PeopleSkeleton count={SKELETON_ROWS} />
    ) : (
      <EmptyState icon="search" title="Find a Bev or a friend" body="Search Bevs by name, brand or flavor, and people by name or @handle." />
    );
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
 * How far to raise the panel's foot so the keyboard never covers it. The panel ends above the tab
 * bar, so only the part of the keyboard taller than what lies below the panel hides anything:
 * measure the panel's bottom in the window, then compare it with the keyboard's top
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
