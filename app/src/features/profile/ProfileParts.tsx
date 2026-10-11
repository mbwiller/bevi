import type { Profile, ProfileStats } from '@bevi/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { HitTarget, PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { StatCard } from '@/components/StatCard';
import { formatCount } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { memberSince, rankCardValue, rankShort, streakCardValue } from './copy';

/** §6.13: the outlined buttons are 120 wide, the chevron 34, with 4pt gaps. */
export const PROFILE_BUTTON_WIDTH = 120;
const MENU_BUTTON_WIDTH = 34;
const BUTTON_HEIGHT = 36;
const AVATAR = 100;
/** §6.13: the stat cards sit 10pt from the screen edges and 10pt apart. */
const STAT_INSET = 10;

interface CountProps {
  value: string;
  label: string;
  onPress?: () => void;
}

function Count({ value, label, onPress }: CountProps) {
  const { colors } = useTheme();
  const body = (
    <>
      <Text style={[type.heading, styles.countValue, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {value}
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [styles.count, pressed && PRESSED]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.count} accessible accessibilityLabel={`${label}, ${value}`}>
      {body}
    </View>
  );
}

export interface ProfileHeroProps {
  profile: Pick<Profile, 'displayName' | 'handle' | 'avatarUrl' | 'createdAt'>;
  stats: ProfileStats;
  onFollowers?: () => void;
  onFollowing?: () => void;
}

/** Avatar 100, @handle, "Member since", then Followers · Following · Rank on Bevi (§6.13). */
export function ProfileHero({ profile, stats, onFollowers, onFollowing }: ProfileHeroProps) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={styles.identity}>
        <Avatar name={profile.displayName} src={profile.avatarUrl ?? undefined} size={AVATAR} />
        <Text style={[type.heading, styles.handle, { color: colors.text }]} numberOfLines={1}>
          @{profile.handle}
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>{memberSince(profile.createdAt)}</Text>
      </View>
      <View style={styles.counts}>
        <Count value={formatCount(stats.followers)} label="Followers" onPress={onFollowers} />
        <Count value={formatCount(stats.following)} label="Following" onPress={onFollowing} />
        <Count value={rankShort(stats)} label="Rank on Bevi" />
      </View>
    </View>
  );
}

/** The centred row of 36pt buttons under the counts. */
export function ProfileButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttons}>{children}</View>;
}

/** The 34pt chevron at the end of your own button row; opens Settings. Its hit area is 44pt. */
export function ProfileMenuButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      style={({ pressed }) => [
        styles.menu,
        { backgroundColor: colors.surface, borderColor: colors.borderStrong },
        pressed && PRESSED,
      ]}
    >
      <HitTarget height={BUTTON_HEIGHT} width={MENU_BUTTON_WIDTH} borderWidth={1} />
      <Icon name="chevron-down" size={18} strokeWidth={2} color={colors.text} />
    </Pressable>
  );
}

/** "Rank on Bevi" and "Current streak", side by side. */
export function ProfileStatCards({ stats, self }: { stats: ProfileStats; self: boolean }) {
  return (
    <View style={styles.stats}>
      <View style={styles.statCell}>
        <StatCard icon="trophy" label="Rank on Bevi" value={rankCardValue(stats)} />
      </View>
      <View style={styles.statCell}>
        <StatCard icon="flame" label="Current streak" value={streakCardValue(stats, self)} />
      </View>
    </View>
  );
}

/** Loading: the hero, the button row and two rows in their final shapes. */
export function ProfileSkeleton() {
  return (
    <View accessibilityLabel="Loading" testID="profile-skeleton" style={styles.skeleton}>
      <View style={styles.identity}>
        <Skeleton variant="circle" width={AVATAR} />
        <Skeleton width={120} style={styles.skelLine} />
        <Skeleton width={160} />
      </View>
      <View style={styles.counts}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.count}>
            <Skeleton width={48} lines={2} />
          </View>
        ))}
      </View>
      <View style={styles.buttons}>
        <Skeleton variant="block" width={PROFILE_BUTTON_WIDTH} height={BUTTON_HEIGHT} />
        <Skeleton variant="block" width={PROFILE_BUTTON_WIDTH} height={BUTTON_HEIGHT} />
      </View>
      <Skeleton variant="post" />
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', paddingTop: 1, gap: spacing.xs },
  handle: { marginTop: spacing.md, fontWeight: '700' },
  counts: { flexDirection: 'row', paddingTop: spacing.lg },
  count: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: size.target },
  countValue: { fontVariant: ['tabular-nums'] },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  menu: {
    width: MENU_BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    borderWidth: 1,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: STAT_INSET, paddingTop: spacing.xl, paddingBottom: spacing.md, paddingHorizontal: STAT_INSET },
  statCell: { flex: 1, minWidth: 0 },
  skeleton: { paddingTop: spacing.sm },
  skelLine: { marginTop: spacing.md },
});
