import { isApiError } from '@bevi/shared';
import type { FlashListRef } from '@shopify/flash-list';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useStats, useUser } from '@/api/hooks';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { useBack } from '@/lib/useBack';
import { PersonNotFound } from '@/features/people/PersonNotFound';
import { FollowButton } from '@/features/people/FollowButton';
import { ActivityList, parseProfileTab, type ActivityRow } from '@/features/profile/ActivityList';
import {
  PROFILE_BUTTON,
  ProfileButtonRow,
  ProfileHero,
  ProfileSkeleton,
  ProfileStatCards,
} from '@/features/profile/ProfileParts';
import { SafetyFlow } from '@/features/safety/SafetyFlow';
import { useSafetyTarget } from '@/features/safety/useSafetyTarget';
import { useShareProfile } from '@/features/profile/useShareProfile';
import { spacing, type, useTheme } from '@/theme';

/**
 * Another user's profile (§6.14): the Profile layout (Bev'd · Followers · Following, then the buttons and
 * the stat cards) with Follow / Following (optimistic) and Share profile, then their rankings. The Bev'd
 * count is a button that does what the old Bev'd row did: it shows their rankings, switching to the
 * Activity tab or, when already there, scrolling to the first ranking (their Bev'd list is that Activity;
 * `/lists` is only yours). With no rankings and the Activity tab already showing it has nothing to do,
 * so it is plain text. The header's More opens Report profile and Block account (blocking leaves the screen). No list rows (Recommended is private, Want to Try has no read) and no
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
  const safety = useSafetyTarget();

  if (isMe) return <Redirect href="/profile" />;

  const notFound = isApiError(user.error) && user.error.code === 'not_found';

  let body;
  if (notFound) {
    body = <PersonNotFound onBack={back} />;
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
    // Nothing to show: no rankings, and the Activity tab (their empty Bev'd list) is already on screen.
    const bevdIdle = tab === 'activity' && s.bevdCount === 0;
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
              onBevd={
                bevdIdle
                  ? undefined
                  : () => {
                      // Their Bev'd list is the Activity below (rankings.listUser), and `/lists` is only yours.
                      if (tab !== 'activity') router.setParams({ tab: 'activity' });
                      else void listRef.current?.scrollToIndex({ index: 0, animated: true });
                    }
              }
              bevdLabel={bevdIdle ? undefined : `Bev'd, ${s.bevdCount}, show their rankings`}
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
      <Header
        title={user.data?.displayName ?? ''}
        onBack={back}
        // Report profile and Block account. Not on a profile that reads as not found (nothing left to act on).
        actions={
          user.data && !notFound
            ? [{ icon: 'ellipsis', label: 'More actions', onPress: () => safety.open({ kind: 'profile', id: user.data.id, author: user.data }) }]
            : []
        }
      />
      <View style={styles.body}>{body}</View>
      {/* Blocking leaves the profile: it now reads as not found. */}
      <SafetyFlow target={safety.target} onClose={safety.close} onBlocked={back} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  notice: { textAlign: 'center', paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
});
