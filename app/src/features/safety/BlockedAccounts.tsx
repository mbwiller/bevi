import type { BlockedUser } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { flattenPages, useBlockedUsers, useUnblock } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { useBack } from '@/lib/useBack';
import { usePullToRefresh } from '@/lib/usePullToRefresh';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { unblockMessage } from './copy';

export const BLOCKED_TITLE = 'Blocked accounts';
export const BLOCKED_EMPTY_TITLE = 'No blocked accounts';
export const BLOCKED_EMPTY_BODY = "People you block can't see your posts or profile, and you can't see theirs. They show up here so you can unblock them.";

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;

/**
 * Settings > Blocked accounts: the people you have blocked, newest first, each with Unblock. A row
 * never opens a profile: a blocked person reads as not found there. Unblocking takes the row away
 * at once and puts it back, with a line saying why, if it fails.
 */
export function BlockedAccounts() {
  const { colors } = useTheme();
  const back = useBack();
  const query = useBlockedUsers();
  const unblock = useUnblock();
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => flattenPages(query.data), [query.data]);

  // mutateAsync, not mutate's per-call callbacks: those fire only for the latest call, so unblocking
  // A then B with A failing would leave A spinning and its error unsaid.
  const { mutateAsync } = unblock;
  const onUnblock = useCallback(
    (id: string) => {
      setError(null);
      setBusy((b) => new Set(b).add(id));
      mutateAsync(id)
        .catch((e: unknown) => setError(unblockMessage(e)))
        .finally(() =>
          setBusy((b) => {
            const next = new Set(b);
            next.delete(id);
            return next;
          }),
        );
    },
    [mutateAsync],
  );

  const renderItem = useCallback(
    ({ item }: { item: BlockedUser }) => <BlockedRow user={item} busy={busy.has(item.id)} onUnblock={onUnblock} />,
    [busy, onUnblock],
  );

  const empty = query.isPending ? (
    <View accessibilityLabel="Loading" testID="blocked-skeleton">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton variant="circle" width={size.target} />
          <Skeleton lines={2} />
        </View>
      ))}
    </View>
  ) : query.isError ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyState icon="users" title={BLOCKED_EMPTY_TITLE} body={BLOCKED_EMPTY_BODY} />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={BLOCKED_TITLE} onBack={back} />
      <Announce text={error} />
      {error ? (
        <Text style={[type.body, styles.notice, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <FlashList
        testID="blocked-list"
        data={rows}
        extraData={busy}
        renderItem={renderItem}
        keyExtractor={(u) => u.id}
        ListEmptyComponent={empty}
        ListFooterComponent={query.isFetchingNextPage ? <Skeleton lines={2} style={styles.footSkel} /> : <View style={styles.foot} />}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </SafeAreaView>
  );
}

const BlockedRow = memo(function BlockedRow({ user, busy, onUnblock }: { user: BlockedUser; busy: boolean; onUnblock: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <View testID={`blocked-row-${user.id}`} style={[styles.row, { borderBottomColor: colors.border }]}>
      {/* Not a link: a blocked person's profile reads as not found. */}
      <View style={styles.who}>
        <Avatar name={user.displayName} src={user.avatarUrl ?? undefined} size={size.target} />
        <View style={styles.text}>
          <Text {...DENSE} style={[type.heading, { color: colors.text }]} numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
            {`@${user.handle}`}
          </Text>
        </View>
      </View>
      <Button
        variant="outlined"
        loading={busy}
        accessibilityLabel={`Unblock ${user.displayName}, @${user.handle}`}
        onPress={() => onUnblock(user.id)}
      >
        Unblock
      </Button>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  notice: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: size.target,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.gutter },
  foot: { height: spacing.xxl },
  footSkel: { marginHorizontal: spacing.gutter },
});
