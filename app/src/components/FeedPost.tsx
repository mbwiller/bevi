import type { BevSummary, Bucket, Comment, Profile } from '@bevi/shared';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { categoryById } from '@/lib/categories';
import { formatRelativeTime } from '@/lib/time';
import { motion, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import type { BevArtProps } from './BevArt';
import { BevActions, bevImageProps } from './BevParts';
import { BevImage } from './BevImage';
import { CommentButton } from './CommentButton';
import { Icon } from './Icon';
import { LikeButton } from './LikeButton';
import { ScoreBubble } from './ScoreBubble';
import { FollowPill } from './UserRow';

export type FeedActor = Pick<Profile, 'displayName' | 'handle' | 'avatarUrl'>;

export interface FeedPostProps {
  actor?: FeedActor;
  /** The viewer's own post: "You Bev'd …". */
  you?: boolean;
  bev: BevSummary;
  score?: number | null;
  scoreVariant?: 'default' | 'predicted' | 'locked';
  /** The actor's bucket: the bubble takes the bucket colour. */
  bucket?: Bucket | null;
  note?: string | null;
  /** ISO timestamp, printed as "5 hours ago" or a weekday. */
  time?: string;
  saved?: boolean;
  /** The viewer liked this post: the heart is filled `primary`. */
  liked?: boolean;
  /** Likes on the post, beside the heart; hidden at 0. */
  likeCount?: number;
  /**
   * Toggles the like from the heart. A double-tap outside the photo strip calls it only when not yet
   * liked. Without it the post has no heart and double-tap does nothing.
   */
  onLike?: () => void;
  /**
   * Comments on the post (the contract's first seven, oldest first), shown under the action row as
   * the author's Avatar 24 and "**handle** text" while `commentCount` ≤ `INLINE_COMMENTS`.
   */
  comments?: Comment[];
  /** All comments on the post: beside the comment icon (hidden at 0); above 7 the post shows "View all N comments". */
  commentCount?: number;
  /** Opens the comments sheet (the comment icon and "View all N comments"). Without it the post has no comment icon. */
  onComment?: () => void;
  /** The viewer follows the author: the Follow pill reads "Following", outlined. */
  following?: boolean;
  /**
   * Shows the author's Follow pill (UserRow's) at the start of the action group, where the heart sits
   * on a feed post. Explore only.
   */
  onFollow?: () => void;
  /** Strip tiles; defaults to the Bev's own photo. An empty list draws no strip. */
  photos?: { src?: string; art?: BevArtProps }[];
  onRank?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Comments shown on the post itself; above this many, the post collapses to "View all N comments". */
export const INLINE_COMMENTS = 7;

/** Notes longer than this truncate with "See more" (FeedPost README). */
const NOTE_MAX = 160;
const NOTE_CUT = 150;

/** The strip's tap sink: a tap between or around the tiles stops here instead of reaching the post. */
const swallowTap = () => {};

/** Two taps on the post's background this close together are a double-tap. */
export const DOUBLE_TAP_MS = 300;

/**
 * A ranking in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**".
 *
 * Double-tap anywhere outside the photo strip likes it (never unlikes; the heart does that). The
 * post's background is a Pressable that only counts taps: two within `DOUBLE_TAP_MS` like. Every
 * control inside (the heart, the comment bubble, Rank, Want to Try, "See more", "View all N comments",
 * the strip's tiles) is its own Pressable,
 * so it takes the tap itself with no delay: on the web the innermost Pressable handles the `click`
 * and stops it bubbling, and natively the deepest responder wins. The strip sits in a tap sink that
 * swallows taps between and around its tiles, so a double-tap on the photo never likes.
 *
 * Inline comments are plain rows (an Avatar 24 and the "**handle** text" line), not controls, so a
 * double-tap on them likes like anywhere else outside the strip.
 */
export function FeedPost({
  actor,
  you = false,
  bev,
  score,
  scoreVariant,
  bucket,
  note,
  time,
  saved = false,
  liked = false,
  likeCount = 0,
  onLike,
  comments = [],
  commentCount = 0,
  onComment,
  following = false,
  onFollow,
  photos,
  onRank,
  onSave,
  onOpen,
  divider = true,
  style,
}: FeedPostProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const cat = categoryById(bev.categoryId);
  const name = actor?.displayName ?? '';
  const who = you ? 'You' : name.split(' ')[0] || (actor ? `@${actor.handle}` : '');
  const image = bevImageProps(bev);
  const tiles = photos ?? [{ src: image.src, art: image.art }];
  const long = !!note && note.length > NOTE_MAX;
  const shown = note && long && !open ? `${note.slice(0, NOTE_CUT).replace(/\s+\S*$/, '')} …` : note;
  const textColor = { color: colors.text };

  const onBackgroundTap = () => {
    if (!onLike) return;
    const now = Date.now();
    if (now - lastTap.current > DOUBLE_TAP_MS) {
      lastTap.current = now;
      return;
    }
    // A third quick tap starts a new pair rather than counting again.
    lastTap.current = 0;
    setBurst((n) => n + 1);
    if (!liked) onLike();
  };

  const noteText = note ? (
    <Text style={[type.bodyLarge, textColor]}>
      <Text style={styles.bold}>Notes:</Text> {shown}
      {long && !open ? <Text style={{ color: colors.textSecondary }}> See more</Text> : null}
    </Text>
  ) : null;

  return (
    <Pressable
      onPress={onBackgroundTap}
      // Not a control of its own: double-tap is an addition to the heart, never the only way to like.
      accessible={false}
      focusable={false}
      tabIndex={-1}
      style={[
        styles.post,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
        divider && styles.divider,
        style,
      ]}
    >
      <View style={styles.head}>
        <Avatar name={name || who} src={actor?.avatarUrl ?? undefined} size={60} />
        <View style={styles.headText}>
          <Text style={[type.screenTitle, textColor]}>
            <Text>{who}</Text>
            <Text style={styles.verb}>{" Bev'd "}</Text>
            <Text>{bev.name}</Text>
          </Text>
          <View style={styles.meta}>
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.textSecondary} /> : null}
            <Text style={[type.body, styles.shrink, { color: colors.textSecondary }]} numberOfLines={1}>
              {bev.brand || cat?.label || ''}
            </Text>
          </View>
        </View>
        {score != null || scoreVariant ? (
          <ScoreBubble score={score} variant={scoreVariant} bucket={bucket ?? undefined} style={styles.score} />
        ) : null}
      </View>

      {tiles.length ? (
        <View style={styles.media}>
          <Pressable
            onPress={swallowTap}
            accessible={false}
            focusable={false}
            tabIndex={-1}
            testID="feed-post-strip"
            style={styles.sink}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
              {tiles.map((t, i) => (
                <Pressable key={i} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${bev.name}`}>
                  <BevImage
                    size={size.bevImageStrip}
                    src={t.src}
                    art={t.art}
                    alt={bev.name}
                    status={!photos && i === 0 ? image.status : 'ready'}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
          {burst ? <LikeBurst key={burst} /> : null}
        </View>
      ) : null}

      {noteText ? (
        long && !open ? (
          // The whole note expands, so "See more" has a full-width target rather than a 20pt word.
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Notes: ${shown} See more`}
            style={[styles.note, styles.noteTarget]}
          >
            {noteText}
          </Pressable>
        ) : (
          <View style={styles.note}>{noteText}</View>
        )
      ) : null}

      <View style={styles.foot}>
        <Text style={[type.body, { color: colors.textSecondary }]}>{time ? formatRelativeTime(time) : ''}</Text>
        <View style={styles.actions}>
          {onFollow ? <FollowPill following={following} name={name || who} onPress={onFollow} /> : null}
          {onLike ? <LikeButton liked={liked} count={likeCount} onPress={onLike} /> : null}
          {onComment ? <CommentButton count={commentCount} onPress={onComment} /> : null}
          {/* Only with an action: its -8pt edge would push a lone Follow pill past the gutter. */}
          {onRank || onSave ? <BevActions name={bev.name} saved={saved} onRank={onRank} onSave={onSave} /> : null}
        </View>
      </View>
      {commentCount > INLINE_COMMENTS ? (
        <Pressable
          onPress={onComment}
          disabled={!onComment}
          accessibilityRole="button"
          accessibilityLabel={`View all ${commentCount} comments`}
          style={styles.allComments}
        >
          <Text style={[type.body, { color: colors.textSecondary }]}>{`View all ${commentCount} comments`}</Text>
        </Pressable>
      ) : comments.length ? (
        // Text, not controls: a double-tap here likes the post like anywhere else outside the strip.
        <View style={styles.comments} role="list" aria-label="Comments" testID="feed-post-comments">
          {comments.slice(0, INLINE_COMMENTS).map((c) => (
            <View key={c.id} role="listitem" style={styles.commentRow} testID={`feed-post-comment-${c.id}`}>
              <Avatar name={c.author.displayName || c.author.handle} src={c.author.avatarUrl ?? undefined} size={24} />
              <Text style={[type.body, styles.comment, textColor]}>
                <Text style={styles.bold}>{c.author.handle}</Text> {c.body}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {burst && !tiles.length ? <LikeBurst key={burst} /> : null}
    </Pressable>
  );
}

/** `.bv-post-comment-text` padding-top: 2px (no spacing token is 2). */
const COMMENT_TEXT_OFFSET = 2;

/** The burst heart (FeedPost README): 88pt, filled `primary`. */
const BURST = 88;
/** bundle.css `@keyframes bv-like-burst` over 800ms: grow to 1.1 by 20%, settle to 1 by 32%, hold to 70%, fade out. */
const BURST_MS = 800;
const BURST_FROM = 0.4;
const BURST_OVERSHOOT = 1.1;

/**
 * The big heart a double-tap bursts over the photo strip (or the post's centre with no photo). It
 * grows on a slight overshoot, holds and fades within 800ms, transform and opacity only; Reduce
 * Motion leaves the fade alone (bundle.css `bv-like-fade`). Remounted with a new key on every burst.
 */
function LikeBurst() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : BURST_FROM);
  const opacity = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  useEffect(() => {
    const at = (share: number) => BURST_MS * share;
    if (reduced) {
      opacity.value = withSequence(
        withTiming(1, { duration: at(0.25) }),
        withDelay(at(0.45), withTiming(0, { duration: at(0.3) })),
      );
      return;
    }
    scale.value = withSequence(
      withTiming(BURST_OVERSHOOT, { duration: at(0.2) }),
      withTiming(1, { duration: at(0.12) }),
    );
    opacity.value = withSequence(
      withTiming(1, { duration: at(0.2) }),
      withDelay(at(0.5), withTiming(0, { duration: at(0.3) })),
    );
  }, [reduced, scale, opacity]);

  return (
    <View style={styles.burst} pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden testID="like-burst">
      <Animated.View style={animated}>
        <Icon name="heart" size={BURST} strokeWidth={1.6} filled color={colors.primary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  post: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.gutter,
    // A double-tap likes, so Safari mustn't zoom on it. react-native-web's Pressable also sets this
    // and a pointer cursor; the post isn't a link, so the cursor goes back to auto.
    ...(Platform.OS === 'web' ? ({ touchAction: 'manipulation', cursor: 'auto' } as ViewStyle) : null),
  },
  divider: { borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxl },
  headText: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
  verb: { fontWeight: '400' },
  bold: { fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  shrink: { flexShrink: 1, minWidth: 0 },
  score: { marginTop: spacing.xs },
  media: { marginTop: spacing.lg, marginHorizontal: -spacing.gutter },
  sink: { cursor: 'auto' },
  stripContent: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  note: { marginTop: spacing.lg },
  noteTarget: { minHeight: size.target },
  // bundle.css `.bv-post-comments` / `.bv-post-allcomments`.
  comments: { gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.sm },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  // bundle.css `.bv-post-comment-text`: `overflow-wrap: anywhere` so a long unbroken word wraps instead of
  // widening the post, and the text starts a little below the avatar's top edge.
  comment: { flex: 1, minWidth: 0, paddingTop: COMMENT_TEXT_OFFSET, ...(Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as TextStyle) : null) },
  allComments: { minHeight: size.target, justifyContent: 'center', alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  burst: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.target,
    marginTop: spacing.sm,
  },
});
