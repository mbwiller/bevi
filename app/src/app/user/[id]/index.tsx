import { isApiError } from '@bevi/shared';
import type { FlashListRef } from '@shopify/flash-list';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useStats, useUser } from '@/api/hooks';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { ProfileListRow } from '@/components/ProfileListRow';
import { useBack } from '@/lib/useBack';
import { FollowButton } from '@/features/people/FollowButton';
import { ActivityList, parseProfileTab, type ActivityRow } from '@/features/profile/ActivityList';
import {
  PROFILE_BUTTON_WIDTH,
  ProfileButtonRow,
  ProfileHero,
  ProfileSkeleton,
  ProfileStatCards,
} from '@/features/profile/ProfileParts';
import { useShareProfile } from '@/features/profile/useShareProfile';
import { spacing, type, useTheme } from '@/theme';

/**
 * Another user's profile (§6.14): the Profile layout with Follow / Following (optimistic) and Share
 * profile, their Bev'd count, stat cards and rankings. No Recommended row (it's private) and no
 * Settings. Your own id redirects to the Profile tab.
 */
export default function UserProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const tab = parseProfileTab(tabParam);
  const me = useMe();
  const isMe = !!me.data && me.data.id === id;
  const user = useUser(isMe ? undefined : id);
  const stats = useStats(isMe ? undefined : id);
  const { share, notice } = useShareProfile(id);
  const listRef = useRef<FlashListRef<ActivityRow> | null>(null);

  if (isMe) return <Redirect href="/profile" />;

  const notFound = isApiError(user.error) && user.error.code === 'not_found';

  let body;
  if (notFound) {
    body = (
      <EmptyState
        icon="user"
        title="This person isn't on Bevi anymore"
        body="Their account may have been deleted."
        action="Go back"
        onAction={back}
      />
    );
  } else if (user.isPending || stats.isPending) {
    body = <ProfileSkeleton />;
  } else if (user.isError || stats.isError) {
    body = (
      <ErrorState
        error={user.error ?? stats.error}
        onRetry={() => {
          void user.refetch();
          void stats.refetch();
        }}
      />
    );
  } else {
    const profile = user.data;
    const s = stats.data;
    const toPeople = (which: 'followers' | 'following') =>
      router.push({ pathname: which === 'followers' ? '/user/[id]/followers' : '/user/[id]/following', params: { id: profile.id } });
    body = (
      <ActivityList
        profile={profile}
        self={false}
        following={profile.isFollowing}
        listRef={listRef}
        tab={tab}
        onTab={(t) => router.setParams({ tab: t })}
        onRefresh={() => {
          void user.refetch();
          void stats.refetch();
        }}
        header={
          <View>
            <ProfileHero
              profile={profile}
              stats={s}
              onFollowers={() => toPeople('followers')}
              onFollowing={() => toPeople('following')}
            />
            <ProfileButtonRow>
              <FollowButton userId={profile.id} name={profile.displayName} following={profile.isFollowing} width={PROFILE_BUTTON_WIDTH} />
              <Button style={styles.button} onPress={() => void share()}>
                Share profile
              </Button>
            </ProfileButtonRow>
            {notice ? (
              <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} accessibilityLiveRegion="polite" role="status">
                {notice}
              </Text>
            ) : null}
            <View style={[styles.rows, { borderTopColor: colors.border }]}>
              {/* Their Bev'd list is the Activity below (rankings.listUser), so the row scrolls to it. The
                  contract has no read of another user's Want to Try, so that row is left out. */}
              <ProfileListRow
                icon="circle-check"
                label="Bev'd"
                count={s.bevdCount}
                onPress={() => {
                  if (tab !== 'activity') router.setParams({ tab: 'activity' });
                  else if (s.bevdCount > 0) void listRef.current?.scrollToIndex({ index: 0, animated: true });
                }}
              />
            </View>
            <ProfileStatCards stats={s} self={false} />
          </View>
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title={user.data?.displayName ?? ''} onBack={back} />
      <View style={styles.body}>{body}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  button: { width: PROFILE_BUTTON_WIDTH, paddingHorizontal: 0 },
  notice: { textAlign: 'center', paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  rows: { borderTopWidth: 1 },
});
