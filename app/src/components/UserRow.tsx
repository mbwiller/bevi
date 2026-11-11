import type { Profile } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { HitTarget, PRESSED } from './HitTarget';
import { Icon } from './Icon';
import { FeedbackPressable } from './PressFeedback';
import { usePop } from './usePop';

export type UserRowUser = Pick<Profile, 'displayName' | 'handle' | 'avatarUrl'>;

export interface UserRowProps {
  user: UserRowUser;
  /** Leaderboard position. */
  rank?: number;
  /** "84 Bevs", "212 pts". */
  meta?: string;
  /** Current streak in days; shows a flame. */
  streak?: number;
  /** A third line with a `users` icon: "Followed by Sam and Arjun". One line, truncated. */
  context?: string;
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
/** bundle.css `.bv-userrow { min-height: 64px }` and `.bv-userrow-rank { width: 28px }`; 72 with a context line. */
const ROW_MIN = 64;
const ROW_MIN_CONTEXT = 72;
const CONTEXT_ICON = 14;
const RANK_W = 28;

/** Person row for People search, followers and the user leaderboard. */
export function UserRow({ user, rank, meta, streak, context, following, self = false, onFollow, onPress, divider = true, style }: UserRowProps) {
  const { colors } = useTheme();
  const secondary = { color: colors.textSecondary };
  return (
    <View
      testID="user-row"
      style={[
        styles.row,
        { backgroundColor: self ? colors.primaryTint : colors.surface, borderBottomColor: colors.border },
        context ? styles.rowContext : null,
        divider && styles.divider,
        style,
      ]}
    >
      {rank != null ? (
        <Text {...DENSE} style={[type.heading, styles.rank, { color: colors.text }]} accessibilityLabel={`Rank ${rank}`}>
          {rank}
        </Text>
      ) : null}
      <FeedbackPressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}${self ? ' (you)' : ''}, @${user.handle}${meta ? `, ${meta}` : ''}${streak ? `, ${streak} day streak` : ''}${context ? `, ${context}` : ''}`}
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
          {context ? (
            <View style={styles.metaLine}>
              <Icon name="users" size={CONTEXT_ICON} strokeWidth={2} color={colors.textSecondary} />
              <Text {...DENSE} style={[type.caption, styles.shrink, styles.contextText, secondary]} numberOfLines={1}>
                {context}
              </Text>
            </View>
          ) : null}
        </View>
      </FeedbackPressable>
      {following != null && !self ? <FollowPill following={following} name={user.displayName} onPress={onFollow} /> : null}
    </View>
  );
}

/**
 * Pill's look (filled Follow, outlined Following) with `aria-pressed` reporting the follow state.
 * Also the author's Follow pill on an Explore FeedPost. A press pops it like the heart (Change);
 * new data alone never does.
 */
export function FollowPill({ following, name, onPress }: { following: boolean; name: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const pop = usePop();
  return (
    <Animated.View style={pop.style} testID="follow-pop">
      <Pressable
        onPress={() => {
          if (!onPress) return;
          pop.pop();
          onPress();
        }}
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
    </Animated.View>
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
  rowContext: { minHeight: ROW_MIN_CONTEXT },
  divider: { borderBottomWidth: 1 },
  rank: { width: RANK_W, textAlign: 'center', fontVariant: ['tabular-nums'] },
  main: { flex: 1, minWidth: 0, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  metaLine: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1, minWidth: 0 },
  contextText: { marginLeft: spacing.xs },
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
