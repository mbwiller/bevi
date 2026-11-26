import type { Notification } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { flattenPages, useMarkNotificationsRead, useNotifications } from '@/api/hooks';
import { keys } from '@/api/keys';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { NotificationRow } from '@/components/NotificationRow';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFollowToggle } from '@/features/people/FollowButton';
import { useBack } from '@/lib/useBack';
import { usePullToRefresh } from '@/lib/usePullToRefresh';
import { NOTIFICATION_SECTION_TITLES, notificationSection, type NotificationSection } from '@/lib/time';
import { size, spacing, useTheme } from '@/theme';

export const NOTIFICATIONS_EMPTY_TITLE = 'No notifications yet';
export const NOTIFICATIONS_EMPTY_BODY = "When someone follows you, likes a Bev you posted or comments on it, you'll see it here.";

const SECTION_ORDER: NotificationSection[] = ['new', 'today', 'week', 'earlier'];

type Item = { kind: 'section'; key: string; title: string } | { kind: 'row'; key: string; n: Notification };

const keyOf = (i: Item) => i.key;
const typeOf = (i: Item) => i.kind;

/** A row the screen can draw: a follow names someone; a like or a comment needs its post and Bev. */
function drawable(n: Notification): boolean {
  if (n.actors.length === 0) return false;
  return n.kind === 'follow' || (!!n.bev && !!n.postId);
}

/** The rows under their section headers, in section order; a section with no rows is left out. */
function sectioned(rows: Notification[], now: Date): Item[] {
  const by = new Map<NotificationSection, Notification[]>();
  for (const n of rows) {
    if (!drawable(n)) continue;
    const s = notificationSection(n, now);
    const list = by.get(s);
    if (list) list.push(n);
    else by.set(s, [n]);
  }
  const out: Item[] = [];
  for (const s of SECTION_ORDER) {
    const list = by.get(s);
    if (!list) continue;
    out.push({ kind: 'section', key: `section:${s}`, title: NOTIFICATION_SECTION_TITLES[s] });
    for (const n of list) out.push({ kind: 'row', key: `n:${n.id}`, n });
  }
  return out;
}

/** Skeleton rows in the NotificationRow shape (a circle and two lines). */
function NotificationsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" testID="notifications-skeleton">
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
 * Notifications (`/notifications`, T-31; design system ScreenNotifications), pushed from the Feed's
 * bell: who followed you, and who liked or commented on your posts, under New, Today, This week and
 * Earlier. Pull to refresh, infinite scroll.
 *
 * Reading: each time the screen is opened (focused; it stays mounted in the tabs navigator between
 * visits), once its first page is in and anything is unread, everything up to the newest row is
 * marked read and the bell goes to 0 at once. The rows keep their tint, under New, while the person
 * is here; leaving (blur) marks the list stale and reads it again behind the scenes, so the next
 * visit shows them read.
 */
export function NotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const qc = useQueryClient();
  const query = useNotifications();
  const { mutate: markRead } = useMarkNotificationsRead();
  const toggle = useFollowToggle();

  const all = useMemo(() => flattenPages(query.data), [query.data]);
  const items = useMemo(() => sectioned(all, new Date()), [all]);

  // What this visit should mark read: the newest row, while anything loaded is unread.
  const upTo = all.length > 0 && all.some((n) => n.unread) ? all[0]!.id : null;
  // The id this visit has marked up to, so a re-render never marks twice; cleared when the screen is left.
  const marked = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (upTo && marked.current !== upTo) {
        marked.current = upTo;
        markRead(upTo);
      }
    }, [upTo, markRead]),
  );

  // Opening again: read the list again if it went stale while the screen was away (the blur below,
  // a follow), or if the bell counts something the list does not have yet. The first opening's
  // read is the mount's own.
  // Read through refs so this effect's only dependency is the (stable) client: a cleanup that ran
  // for a changed dependency, not a blur, would take the tint off rows the person is reading.
  const visits = useRef(0);
  const latest = useRef(query);
  latest.current = query;
  useFocusEffect(
    useCallback(() => {
      visits.current += 1;
      const counted = (qc.getQueryData<number>(keys.notifications.unreadCount()) ?? 0) > 0;
      if (visits.current > 1 && (latest.current.isStale || counted)) void latest.current.refetch();
      return () => {
        // Left: what was new is read now. Stale, and read again while it is out of sight.
        marked.current = null;
        void qc.invalidateQueries({ queryKey: keys.notifications.list() });
      };
    }, [qc]),
  );

  const findPeople = useCallback(() => router.push('/people'), [router]);

  const open = useCallback(
    (n: Notification) => {
      if (n.kind === 'follow') {
        const actor = n.actors[0];
        if (actor) router.push({ pathname: '/user/[id]', params: { id: actor.id } });
      } else if (n.postId) {
        router.push({ pathname: '/post/[id]', params: n.kind === 'comment' ? { id: n.postId, comments: '1' } : { id: n.postId } });
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'section') return <SectionHeader title={item.title} />;
      const { n } = item;
      const actor = n.actors[0];
      return (
        <NotificationRow
          kind={n.kind}
          actors={n.actors}
          actorCount={n.actorCount}
          bev={n.bev}
          comment={n.comment?.body}
          time={n.createdAt}
          unread={n.unread}
          following={n.kind === 'follow' && actor ? actor.isFollowing : undefined}
          onFollow={actor ? () => toggle(actor.id, actor.isFollowing) : undefined}
          onPress={() => open(n)}
        />
      );
    },
    [open, toggle],
  );

  const { refreshing, onRefresh } = usePullToRefresh(() =>
    Promise.all([query.refetch(), qc.invalidateQueries({ queryKey: keys.notifications.unreadCount() })]),
  );

  const empty = query.isPending ? (
    <NotificationsSkeleton />
  ) : query.isError ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyState icon="bell" title={NOTIFICATIONS_EMPTY_TITLE} body={NOTIFICATIONS_EMPTY_BODY} action="Find people" onAction={findPeople} />
  );

  const footer = query.isFetchingNextPage ? (
    <NotificationsSkeleton count={2} />
  ) : query.isFetchNextPageError ? (
    <ErrorState error={query.error} onRetry={() => void query.fetchNextPage()} />
  ) : (
    <View style={styles.foot} />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Notifications" onBack={back} />
      <FlashList
        testID="notifications-list"
        data={items}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemType={typeOf}
        ListEmptyComponent={<>{empty}</>}
        ListFooterComponent={items.length > 0 ? footer : null}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  foot: { height: spacing.xxl },
});
