import type { Profile, ProfileStats } from '@bevi/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PRESSED } from '@/components/HitTarget';
import { Skeleton } from '@/components/Skeleton';
import { StatCard } from '@/components/StatCard';
import { formatCount } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { memberSince, rankCardValue, streakCardValue } from './copy';

/** The two profile buttons are equal and fill the row between the gutters; 36pt tall. */
const BUTTON_HEIGHT = 36;
const AVATAR = 100;
/** §6.13: the stat cards sit 10pt from the screen edges and 10pt apart. */
const STAT_INSET = 10;
/** StatCard's `min-height`. */
const STAT_CARD_HEIGHT = 84;

interface CountProps {
  value: string;
  label: string;
  onPress?: () => void;
  /** Overrides the pressable count's label ("12 Followers") and role (link). */
  pressLabel?: string;
  pressRole?: 'link' | 'button';
}

function Count({ value, label, onPress, pressLabel, pressRole = 'link' }: CountProps) {
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
      accessibilityRole={pressRole}
      accessibilityLabel={pressLabel ?? `${value} ${label}`}
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
  /** Makes the Bev'd count a button. Omit where there is nothing for it to do: it is then plain text. */
  onBevd?: () => void;
  /** The Bev'd button's accessible name; defaults to "12 Bev'd" (your own, which opens your list). */
  bevdLabel?: string;
  onFollowers?: () => void;
  onFollowing?: () => void;
}

/** Avatar 100, @handle, "Member since", then Bev'd · Followers · Following. */
export function ProfileHero({ profile, stats, onBevd, bevdLabel, onFollowers, onFollowing }: ProfileHeroProps) {
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
        <Count value={formatCount(stats.bevdCount)} label="Bev'd" onPress={onBevd} pressLabel={bevdLabel} pressRole={bevdLabel ? 'button' : 'link'} />
        <Count value={formatCount(stats.followers)} label="Followers" onPress={onFollowers} />
        <Count value={formatCount(stats.following)} label="Following" onPress={onFollowing} />
      </View>
    </View>
  );
}

/** The row of two equal 36pt buttons under the counts: each child takes `PROFILE_BUTTON` to share the width. */
export const PROFILE_BUTTON = { flex: 1, minWidth: 0, paddingHorizontal: 0 } as const;

export function ProfileButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttons}>{children}</View>;
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

/** Loading: the hero, the button row, the two stat cards and a post in their final shapes. */
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
        <Skeleton variant="block" width="100%" height={BUTTON_HEIGHT} style={styles.skelButton} />
        <Skeleton variant="block" width="100%" height={BUTTON_HEIGHT} style={styles.skelButton} />
      </View>
      <View style={styles.stats}>
        <View style={styles.statCell}>
          <Skeleton variant="block" width="100%" height={STAT_CARD_HEIGHT} />
        </View>
        <View style={styles.statCell}>
          <Skeleton variant="block" width="100%" height={STAT_CARD_HEIGHT} />
        </View>
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
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
  },
  skelButton: { flex: 1, minWidth: 0 },
  stats: { flexDirection: 'row', gap: STAT_INSET, paddingTop: spacing.lg, paddingBottom: spacing.lg, paddingHorizontal: STAT_INSET },
  statCell: { flex: 1, minWidth: 0 },
  skeleton: { paddingTop: spacing.sm },
  skelLine: { marginTop: spacing.md },
});
