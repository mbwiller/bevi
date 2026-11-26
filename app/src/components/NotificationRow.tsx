import type { BevSummary, NotificationKind, Profile } from '@bevi/shared';
import { Fragment } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatRelativeTime, formatShortAge } from '@/lib/time';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { BevImage } from './BevImage';
import { bevImageProps } from './BevParts';
import { FeedbackPressable } from './PressFeedback';
import { FollowPill } from './UserRow';

/** A person a row names: by handle, with their photo or initials. */
export type NotificationRowActor = Pick<Profile, 'displayName' | 'handle' | 'avatarUrl'>;

export interface NotificationRowProps {
  /** A new follower, a like on your post, or a comment on it. */
  kind: NotificationKind;
  /** Who did it, newest first. One person shows a 44pt avatar; two show a pair of 32pt avatars. Only the first two are named. */
  actors: NotificationRowActor[];
  /** How many people in all; more than the two shown adds "and N others". Defaults to `actors.length`. */
  actorCount?: number;
  /** The post's Bev, for a like or a comment: its name ends the sentence and its image is the 40pt thumbnail. */
  bev?: BevSummary | null;
  /** The comment, quoted in `textSecondary` on up to two lines. */
  comment?: string | null;
  /** When it happened (ISO): shown as a short age ("2m", "3d", "2w"), spoken in words. */
  time: string;
  /** Tints the row `primaryTint`, adds the dot, and starts the spoken sentence with "Unread." */
  unread?: boolean;
  /** A follow row only: whether you follow them back. Shows "Follow back" or "Following"; omit to show no pill. */
  following?: boolean;
  onFollow?: () => void;
  /** Opens the post (a like, or a comment with its comments up) or the person's profile (a follow). */
  onPress?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VERB: Record<NotificationKind, string> = {
  follow: 'started following you',
  like: 'liked your',
  comment: 'commented on your',
};

const DENSE = { maxFontSizeMultiplier: MAX_FONT_SCALE_DENSE } as const;
/** Geometry from bundle.css `.bv-notif*`: a 64pt row, a 6pt dot 5pt in from the left, 32pt avatars paired in a 44pt box. */
const ROW_MIN = 64;
const DOT = 6;
const DOT_LEFT = 5;
const PAIR_AVATAR = 32;
const THUMB = 40;
/** The age joins the sentence with non-breaking spaces, so " · 2m" never starts a line alone. */
const AGE_JOIN = ' · ';

/**
 * Who a row names and how many more: "a", "a and b", "a, b and 3 others" (or "a and 1 other").
 * Only the first two actors are named.
 */
export function notificationActors(actors: NotificationRowActor[], actorCount?: number): { names: string[]; others: number } {
  const names = actors.slice(0, 2).map((a) => a.handle);
  const others = Math.max((actorCount ?? actors.length) - names.length, 0);
  return { names, others };
}

function othersText(others: number): string {
  return `${others} ${others === 1 ? 'other' : 'others'}`;
}

/** The people part of the sentence as plain text. */
function whoText(names: string[], others: number): string {
  if (others === 0) return names.join(' and ');
  return `${names.join(', ')} and ${othersText(others)}`;
}

/** What they did, as plain text: "started following you", "liked your Diet Coke". */
function whatText(kind: NotificationKind, bev: BevSummary | null | undefined): string {
  return kind === 'follow' ? VERB.follow : `${VERB[kind]} ${bev?.name ?? 'post'}`;
}

/**
 * The row's spoken sentence: "Unread. priya, samo and 3 others liked your Diet Coke, 2 minutes ago",
 * with a comment's text after it. Exported for the screen's tests.
 */
export function notificationLabel({
  kind,
  actors,
  actorCount,
  bev,
  comment,
  time,
  unread,
}: Pick<NotificationRowProps, 'kind' | 'actors' | 'actorCount' | 'bev' | 'comment' | 'time' | 'unread'>): string {
  const { names, others } = notificationActors(actors, actorCount);
  const age = formatRelativeTime(time);
  return `${unread ? 'Unread. ' : ''}${whoText(names, others)} ${whatText(kind, bev)}${age ? `, ${age}` : ''}${comment ? `. “${comment}”` : ''}`;
}

/**
 * One line of the Notifications screen (design system NotificationRow): who did it, what they did
 * and how long ago, ending in the post's Bev or a Follow back pill. Likes on one post share a row
 * with two avatars and "and N others". An unread row is tinted `primaryTint` and carries a dot;
 * colour is never the only signal, as its spoken sentence starts with "Unread.".
 *
 * The row body is one target (it gives way under a press, like UserRow); the pill is its own.
 */
export function NotificationRow({
  kind,
  actors,
  actorCount,
  bev,
  comment,
  time,
  unread = false,
  following,
  onFollow,
  onPress,
  divider = true,
  style,
}: NotificationRowProps) {
  const { colors } = useTheme();
  const background = unread ? colors.primaryTint : colors.surface;
  const { names, others } = notificationActors(actors, actorCount);
  const shown = actors.slice(0, 2);
  const first = shown[0];
  const bold = [styles.bold, { color: colors.text }];
  const thumb = kind !== 'follow' && bev ? bev : null;
  return (
    <View
      testID="notification-row"
      style={[styles.row, { backgroundColor: background, borderBottomColor: colors.border }, divider && styles.divider, style]}
    >
      {unread ? <View testID="notification-unread-dot" style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
      <FeedbackPressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={notificationLabel({ kind, actors, actorCount, bev, comment, time, unread })}
        style={styles.main}
      >
        {shown.length > 1 ? (
          <View style={styles.pair} testID="notification-pair">
            <Avatar name={shown[0]!.displayName} src={shown[0]!.avatarUrl ?? undefined} size={PAIR_AVATAR} style={styles.pairFirst} />
            <Avatar
              name={shown[1]!.displayName}
              src={shown[1]!.avatarUrl ?? undefined}
              size={PAIR_AVATAR}
              ring
              // The ring is cut from the row's own background, tinted or not.
              style={[styles.pairSecond, { outlineColor: background }]}
            />
          </View>
        ) : (
          <Avatar name={first?.displayName ?? ''} src={first?.avatarUrl ?? undefined} size={44} />
        )}
        <View style={styles.text}>
          <Text {...DENSE} style={[type.body, { color: colors.text }]}>
            {names.map((name, i) => (
              <Fragment key={i}>
                {i > 0 ? (others ? ', ' : ' and ') : ''}
                <Text style={bold}>{name}</Text>
              </Fragment>
            ))}
            {others ? ` and ${othersText(others)}` : ''}
            {` ${VERB[kind]}`}
            {kind !== 'follow' ? (
              <>
                {' '}
                <Text style={bold}>{bev?.name ?? 'post'}</Text>
              </>
            ) : null}
            <Text style={{ color: colors.textSecondary }}>{AGE_JOIN + formatShortAge(time)}</Text>
          </Text>
          {comment ? (
            <Text {...DENSE} style={[type.body, { color: colors.textSecondary }]} numberOfLines={2} testID="notification-quote">
              {`“${comment}”`}
            </Text>
          ) : null}
        </View>
        {thumb ? <BevImage {...bevImageProps(thumb)} alt="" size={THUMB} /> : null}
      </FeedbackPressable>
      {kind === 'follow' && following != null && first ? (
        <FollowPill following={following} name={first.handle} text="Follow back" onPress={onFollow} />
      ) : null}
    </View>
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
  dot: { position: 'absolute', left: DOT_LEFT, top: '50%', width: DOT, height: DOT, marginTop: -DOT / 2, borderRadius: radius.pill },
  main: { flex: 1, minWidth: 0, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pair: { width: size.target, height: size.target },
  pairFirst: { position: 'absolute', left: 0, top: 0 },
  pairSecond: { position: 'absolute', right: 0, bottom: 0 },
  text: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
});
