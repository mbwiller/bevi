import { isApiError } from '@bevi/shared';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useStats, useUser } from '@/api/hooks';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { useBack } from '@/lib/useBack';
import { FollowButton } from '@/features/people/FollowButton';
import { ActivityList, parseProfileTab } from '@/features/profile/ActivityList';
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
 * count is plain text: the contract has no read of another user's Bev'd list beyond the Activity below,
 * and `/lists` is only yours. No list rows (Recommended is private, Want to Try has no read) and no
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
