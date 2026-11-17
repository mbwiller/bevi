import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useStats } from '@/api/hooks';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { ProfileListRow } from '@/components/ProfileListRow';
import { ActivityList, parseProfileTab } from '@/features/profile/ActivityList';
import { EditProfileSheet } from '@/features/profile/EditProfileSheet';
import {
  PROFILE_BUTTON,
  ProfileButtonRow,
  ProfileHero,
  ProfileSkeleton,
  ProfileStatCards,
} from '@/features/profile/ProfileParts';
import { useShareProfile } from '@/features/profile/useShareProfile';
import { useSession } from '@/state/session';
import { spacing, type, useTheme } from '@/theme';

/**
 * Your profile (§6.13, design system ScreenProfile): name header with Settings, Avatar 100, handle,
 * counts (Bev'd · Followers · Following), Edit profile / Share profile, the two stat cards, the Want to
 * Try and Recommended rows, then Activity (your rankings as FeedPosts) and Taste Profile (the category
 * bars and the preference read-out). `?tab=activity|taste`.
 */
export default function ProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = parseProfileTab(params.tab);
  const sessionName = useSession((s) => s.profile?.displayName);
  const me = useMe();
  const stats = useStats();
  const [editing, setEditing] = useState(false);
  const { share, notice } = useShareProfile(me.data?.id);
  const openSettings = () => router.push('/settings');

  const header = (
    <Header
      title={me.data?.displayName ?? sessionName ?? 'Profile'}
      actions={[{ icon: 'menu', label: 'Settings', onPress: openSettings }]}
    />
  );

  let body;
  if (me.isPending || stats.isPending) {
    body = <ProfileSkeleton />;
  } else if (me.isError || stats.isError) {
    body = (
      <ErrorState
        error={me.error ?? stats.error}
        onRetry={() => {
          void me.refetch();
          void stats.refetch();
        }}
      />
    );
  } else {
    const profile = me.data;
    const s = stats.data;
    const toList = (t: 'bevd' | 'want' | 'recommended') => router.push({ pathname: '/lists', params: { tab: t } });
    const toPeople = (which: 'followers' | 'following') =>
      router.push({ pathname: which === 'followers' ? '/user/[id]/followers' : '/user/[id]/following', params: { id: profile.id } });
    body = (
      <ActivityList
        profile={profile}
        self
        tab={tab}
        onTab={(t) => router.setParams({ tab: t })}
        onEmptyAction={() => router.push({ pathname: '/add', params: { focus: '1' } })}
        onRefresh={() => {
          void me.refetch();
          void stats.refetch();
        }}
        header={
          <View>
            <ProfileHero
              profile={profile}
              stats={s}
              onBevd={() => toList('bevd')}
              onFollowers={() => toPeople('followers')}
              onFollowing={() => toPeople('following')}
            />
            <ProfileButtonRow>
              <Button style={PROFILE_BUTTON} onPress={() => setEditing(true)}>
                Edit profile
              </Button>
              <Button style={PROFILE_BUTTON} onPress={() => void share()}>
                Share profile
              </Button>
            </ProfileButtonRow>
            {notice ? (
              <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} accessibilityLiveRegion="polite" role="status">
                {notice}
              </Text>
            ) : null}
            <ProfileStatCards stats={s} self />
            <View style={[styles.rows, { borderTopColor: colors.border }]}>
              <ProfileListRow icon="bookmark" iconFilled label="Want to Try" count={s.wantToTryCount} onPress={() => toList('want')} />
              <ProfileListRow icon="heart" label="Recommended for you" onPress={() => toList('recommended')} />
            </View>
          </View>
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      {header}
      <View style={styles.body}>{body}</View>
      {me.data ? <EditProfileSheet open={editing} profile={me.data} onClose={() => setEditing(false)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  notice: { textAlign: 'center', paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  rows: { borderTopWidth: 1 },
});
