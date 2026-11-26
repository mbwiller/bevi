import type { NotificationSettings, PostNotificationPerson } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  flattenPages,
  useNotificationSettings,
  usePostNotificationPeople,
  useSetPostNotification,
  useUpdateNotificationSettings,
} from '@/api/hooks';
import { keys } from '@/api/keys';
import { Announce } from '@/components/Announce';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { Switch } from '@/components/Switch';
import { useDebouncedValue } from '@/features/add-bev/useDebouncedValue';
import { actionErrorMessage } from '@/lib/errorCopy';
import { useBack } from '@/lib/useBack';
import { usePullToRefresh } from '@/lib/usePullToRefresh';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { afterPersonChosen } from './settingsRules';

export const POST_NOTIFICATIONS_TITLE = 'Post notifications';
export const POST_NOTIFICATIONS_CAPTION = "You'll hear when the people you switch on post a Bev. The likes and comments they get are never sent.";
export const POST_PEOPLE_EMPTY_TITLE = 'Follow people to choose from them';
export const POST_PEOPLE_EMPTY_BODY = 'Post notifications are for people you follow.';

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;
/** A person's row (`.ns-person`: `min-height: 64px`): a 44pt avatar and 8pt above and below it. */
const POST_PERSON_ROW = 64;

/** Its accessible name: "Post notifications for friend_a". */
export const personSwitchLabel = (handle: string) => `Post notifications for ${handle}`;

/** Skeleton rows in the person row's shape. */
function PostPeopleSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" testID="post-people-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton variant="circle" width={size.target} />
          <Skeleton lines={1} />
        </View>
      ))}
    </View>
  );
}

/**
 * Post notifications (`/settings/post-notifications`, T-31 Release 2; design system
 * ScreenNotificationSettings, its second phone): the people you follow, those already chosen
 * first, each with a Switch, and a search over them. Switching someone on also turns Posts on, by
 * the same rule as Posts' own switch (`afterPersonChosen`), so it ends a pause with only Posts on.
 * Switching someone off changes nothing else. Unfollowing someone takes them off the list (the
 * server does it).
 */
export function PostNotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const q = useDebouncedValue(typed.trim());
  const query = usePostNotificationPeople(q);
  const settings = useNotificationSettings();
  const { mutateAsync: choose } = useSetPostNotification();
  const { mutateAsync: saveSettings } = useUpdateNotificationSettings();
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => flattenPages(query.data), [query.data]);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);

  const { refetch: refetchSettings } = settings;
  const onToggle = useCallback(
    (person: PostNotificationPerson, on: boolean) => {
      setError(null);
      choose({ userId: person.id, on })
        .then(async () => {
          if (!on) return;
          const current =
            qc.getQueryData<NotificationSettings>(keys.notifications.settings()) ?? (await refetchSettings({ throwOnError: true })).data;
          if (!current) return;
          const next = afterPersonChosen(current);
          if (next !== current) await saveSettings(next);
        })
        .catch((e: unknown) => setError(`Couldn't change post notifications for ${person.handle}. ${actionErrorMessage(e)}`));
    },
    [choose, qc, refetchSettings, saveSettings],
  );

  const renderItem = useCallback(({ item }: { item: PostNotificationPerson }) => <PersonRow person={item} onToggle={onToggle} />, [onToggle]);

  const empty = query.isPending ? (
    <PostPeopleSkeleton />
  ) : query.isError ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : q ? (
    <EmptyState icon="search" title={`No one you follow matches "${q}"`} action="Clear search" onAction={() => setTyped('')} />
  ) : (
    <EmptyState icon="users" title={POST_PEOPLE_EMPTY_TITLE} body={POST_PEOPLE_EMPTY_BODY} action="Find people" onAction={() => router.push('/people')} />
  );

  const footer = query.isFetchingNextPage ? (
    <PostPeopleSkeleton count={2} />
  ) : query.isFetchNextPageError ? (
    <ErrorState error={query.error} onRetry={() => void query.fetchNextPage()} />
  ) : (
    <View style={styles.foot} />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={POST_NOTIFICATIONS_TITLE} onBack={back} />
      <View style={styles.search}>
        <SearchBar placeholder="Search people you follow" value={typed} onChange={setTyped} onClear={() => setTyped('')} />
      </View>
      <Text style={[type.caption, styles.caption, { color: colors.textSecondary }]}>{POST_NOTIFICATIONS_CAPTION}</Text>
      <Announce text={error} />
      {error ? (
        <Text style={[type.body, styles.caption, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <SectionHeader title="People you follow" />
      <FlashList
        testID="post-people-list"
        data={rows}
        renderItem={renderItem}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<>{empty}</>}
        ListFooterComponent={rows.length > 0 ? footer : null}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const PersonRow = memo(function PersonRow({
  person,
  onToggle,
}: {
  person: PostNotificationPerson;
  onToggle: (person: PostNotificationPerson, on: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View testID={`post-person-${person.id}`} style={[styles.row, { borderBottomColor: colors.border }]}>
      <Avatar name={person.displayName} src={person.avatarUrl ?? undefined} size={size.target} />
      <Text {...DENSE} style={[type.heading, styles.handle, { color: colors.text }]} numberOfLines={1}>
        {person.handle}
      </Text>
      <Switch label={personSwitchLabel(person.handle)} checked={person.subscribed} onChange={(on) => onToggle(person, on)} />
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.xs },
  caption: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: POST_PERSON_ROW,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderBottomWidth: 1,
  },
  handle: { flex: 1, minWidth: 0 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.gutter },
  foot: { height: spacing.xxl },
});
