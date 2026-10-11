import type { Profile } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { HitTarget, PRESSED } from './HitTarget';
import { Icon } from './Icon';

export type UserRowUser = Pick<Profile, 'displayName' | 'handle' | 'avatarUrl'>;

export interface UserRowProps {
  user: UserRowUser;
  /** Leaderboard position. */
  rank?: number;
  /** "84 Bevs", "212 pts". */
  meta?: string;
  /** Current streak in days; shows a flame. */
  streak?: number;
  /** Shows the Follow / Following pill (never on your own row). */
  following?: boolean;
  /** Your own row: "(you)" and a `primaryTint` highlight. */
  self?: boolean;
  onFollow?: () => void;
  onPress?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;
/** bundle.css `.bv-userrow { min-height: 64px }` and `.bv-userrow-rank { width: 28px }`. */
const ROW_MIN = 64;
const RANK_W = 28;

/** Person row for People search, followers and the user leaderboard. */
export function UserRow({ user, rank, meta, streak, following, self = false, onFollow, onPress, divider = true, style }: UserRowProps) {
  const { colors } = useTheme();
  const secondary = { color: colors.textSecondary };
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: self ? colors.primaryTint : colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      {rank != null ? (
        <Text {...DENSE} style={[type.heading, styles.rank, { color: colors.text }]} accessibilityLabel={`Rank ${rank}`}>
          {rank}
        </Text>
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}${self ? ' (you)' : ''}, @${user.handle}${meta ? `, ${meta}` : ''}${streak ? `, ${streak} day streak` : ''}`}
        style={styles.main}
      >
        <Avatar name={user.displayName} src={user.avatarUrl ?? undefined} size={44} />
        <View style={styles.text}>
          <Text {...DENSE} style={[type.heading, { color: colors.text }]} numberOfLines={1}>
            {user.displayName}
            {self ? ' (you)' : ''}
          </Text>
          <View style={styles.metaLine}>
            <Text {...DENSE} style={[type.body, styles.shrink, secondary]} numberOfLines={1}>
              @{user.handle}
              {meta ? ` · ${meta}` : ''}
              {streak ? ' · ' : ''}
            </Text>
            {streak ? (
              <>
                <Icon name="flame" size={14} strokeWidth={2.25} color={colors.primary} />
                <Text {...DENSE} style={[type.body, secondary]}>{` ${streak}`}</Text>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>
      {following != null && !self ? <FollowPill following={following} name={user.displayName} onPress={onFollow} /> : null}
    </View>
  );
}

/** Pill's look (filled Follow, outlined Following) with `aria-pressed` reporting the follow state. */
function FollowPill({ following, name, onPress }: { following: boolean; name: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Follow ${name}`}
      {...({ 'aria-pressed': following } as object)}
      style={({ pressed }) => [
        styles.pill,
        following
          ? { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 }
          : { backgroundColor: colors.primary },
        pressed && PRESSED,
      ]}
    >
      <HitTarget height={size.pill} borderWidth={following ? 1 : 0} />
      <Text
        {...DENSE}
        style={[type.body, following ? styles.pillOutlined : styles.pillFilled, { color: following ? colors.text : colors.onPrimary }]}
        numberOfLines={1}
      >
        {following ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: ROW_MIN,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gutter,
  },
  divider: { borderBottomWidth: 1 },
  rank: { width: RANK_W, textAlign: 'center', fontVariant: ['tabular-nums'] },
  main: { flex: 1, minWidth: 0, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  metaLine: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1, minWidth: 0 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.pill,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  pillOutlined: { fontWeight: '500' },
  pillFilled: { fontWeight: '600' },
});
