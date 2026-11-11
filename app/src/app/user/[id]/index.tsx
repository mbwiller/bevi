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
import { useBack } from '@/lib/useBack';
import { FollowButton } from '@/features/people/FollowButton';
import { ActivityList, parseProfileTab, type ActivityRow } from '@/features/profile/ActivityList';
import {
  PROFILE_BUTTON,
  ProfileButtonRow,
  ProfileHero,
  ProfileSkeleton,
  ProfileStatCards,
} from '@/features/profile/ProfileParts';
import { useShareProfile } from '@/features/profile/useShareProfile';
import { spacing, type, useTheme } from '@/theme';

/**
 * Another user's profile (§6.14): the Profile layout (Bev'd · Followers · Following, then the buttons and
 * the stat cards) with Follow / Following (optimistic) and Share profile, then their rankings. The Bev'd
 * count is a button that does what the old Bev'd row did: it shows their rankings, switching to the
 * Activity tab or, when already there, scrolling to the first ranking (their Bev'd list is that Activity;
 * `/lists` is only yours). No list rows (Recommended is private, Want to Try has no read) and no
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
              onBevd={() => {
                // Their Bev'd list is the Activity below (rankings.listUser), and `/lists` is only yours.
                if (tab !== 'activity') router.setParams({ tab: 'activity' });
                else if (s.bevdCount > 0) void listRef.current?.scrollToIndex({ index: 0, animated: true });
              }}
              bevdLabel={`Bev'd, ${s.bevdCount}, show their rankings`}
              onFollowers={() => toPeople('followers')}
              onFollowing={() => toPeople('following')}
            />
            <ProfileButtonRow>
              <FollowButton userId={profile.id} name={profile.displayName} following={profile.isFollowing} style={PROFILE_BUTTON} />
              <Button style={PROFILE_BUTTON} onPress={() => void share()}>
                Share profile
              </Button>
            </ProfileButtonRow>
            {notice ? (
              <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} accessibilityLiveRegion="polite" role="status">
                {notice}
              </Text>
            ) : null}
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
  notice: { textAlign: 'center', paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
});
