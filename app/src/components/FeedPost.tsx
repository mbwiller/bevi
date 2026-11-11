import type { BevSummary, Bucket, Comment, Profile } from '@bevi/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { formatRatings, formatScore } from '@/lib/format';
import { formatRelativeTime } from '@/lib/time';
import { size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { AvatarStack } from './AvatarStack';
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
  /** ISO timestamp, printed on the meta line as "5 hours ago" or a weekday. */
  time?: string;
  saved?: boolean;
  /** The viewer liked this post: the heart is filled `primary`. */
  liked?: boolean;
  /** Likes on the post, beside the heart; hidden at 0. */
  likeCount?: number;
  /**
   * Toggles the like from the heart. A double-tap outside the photos calls it only when not yet
   * liked. Without it the post has no heart and double-tap does nothing.
   */
  onLike?: () => void;
  /**
   * Comments on the post (the contract's first seven, oldest first), shown under the foot as the
   * author's Avatar 24 and "**handle** text" while `commentCount` ≤ `INLINE_COMMENTS`.
   */
  comments?: Comment[];
  /** All comments on the post: beside the comment icon (hidden at 0); above 7 the post shows "View all N comments". */
  commentCount?: number;
  /** Opens the comments sheet (the comment icon and "View all N comments"). Without it the post has no comment icon. */
  onComment?: () => void;
  /** The viewer follows the author: the Follow pill reads "Following", outlined. */
  following?: boolean;
  /**
   * Shows the author's Follow pill (UserRow's) first in the foot's left group, where the heart sits
   * on a feed post. Explore only.
   */
  onFollow?: () => void;
  /**
   * People's own photos of the Bev: a scrolling strip with the note under it. Without it the post
   * shows the Bev's own picture (112pt) with the note beside it. An empty list draws neither.
   */
  photos?: { src?: string; art?: BevArtProps }[];
  /**
   * People the viewer follows (not the actor, not the viewer) who have ranked this Bev too, most
   * recent first: "**Arjun** and **Priya** Bev'd it too". The first two are named. Nothing renders
   * when absent or empty.
   */
  alsoBevdBy?: FeedActor[];
  /** How many people `alsoBevdBy` stands for in all; past the two named, "and 3 others". Defaults to its length. */
  alsoBevdCount?: number;
  onRank?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Comments shown on the post itself; above this many, the post collapses to "View all N comments". */
export const INLINE_COMMENTS = 7;

/** The head's Avatar. FeedPostItem lays its actor link over it. */
export const POST_AVATAR = 44;

/** The Bev's own picture beside the note, in pt (no size token names it). */
export const POST_PICTURE = 112;

/**
 * Notes longer than `max` characters truncate to about `cut` with "See more". The cut is by
 * character count, not by line. Under a photo strip the note has the post's full width (the design
 * system's FeedPost README: 160). Beside the picture the column is the screen width less the two
 * gutters, the picture and the gap: 164pt on a 320pt screen, 237pt on a 393pt one. The shorter cut
 * keeps the collapsed note near four `bodyLarge` lines on a typical phone, but it can run past four
 * on a narrow screen or at large text sizes. Nothing is clipped: the note has no line limit.
 */
const NOTE_FULL = { max: 160, cut: 150 };
const NOTE_SIDE = { max: 84, cut: 72 };

/** The meta line's gap under the sentence and the note column's top and bottom inset, in pt (no spacing token is 2). */
const HAIRLINE_OFFSET = 2;

/** "Bev'd it too": the AvatarStack and the names stop at two. */
const ALSO_NAMED = 2;

/** The strip's tap sink: a tap between or around the tiles stops here instead of reaching the post. */
const swallowTap = () => {};

/** Two taps on the post's background this close together are a double-tap. */
export const DOUBLE_TAP_MS = 300;

/** A person as the post names them: the first name, else the handle. */
const firstName = (p: Pick<Profile, 'displayName' | 'handle'>) => p.displayName.split(' ')[0] || `@${p.handle}`;

/** The meta line's parts, "Brand · 5 hours ago": the brand (the category's name with no brand), then the relative time. */
function metaParts(bev: BevSummary, categoryLabel: string | undefined, time: string | undefined): { brand: string; when: string } {
  return { brand: bev.brand || categoryLabel || '', when: time ? formatRelativeTime(time) : '' };
}

/** "8.4 on Bevi · 41 ratings", or null when the Bev has no Bayesian score yet. */
export function beviScoreLine(bev: Pick<BevSummary, 'bayesScore' | 'ratingCount'>): string | null {
  return bev.bayesScore == null ? null : `${formatScore(bev.bayesScore)} on Bevi · ${formatRatings(bev.ratingCount)}`;
}

/**
 * The "Bev'd it too" sentence's parts: the first two names and how many more there are.
 * "Arjun Bev'd it too", "Arjun and Priya …", "Arjun, Priya and 3 others …". Null with nobody.
 */
export function alsoBevdParts(people: FeedActor[] | undefined, count?: number): { names: string[]; others: number } | null {
  if (!people?.length) return null;
  const names = people.slice(0, ALSO_NAMED).map(firstName);
  const total = Math.max(count ?? people.length, people.length);
  return { names, others: total - names.length };
}

/**
 * A ranking in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**".
 *
 * Head: Avatar 44, the sentence (two lines at most) over the meta line (category icon, brand, time),
 * the ScoreBubble. Body: the Bev's 112pt picture with the note beside it and the Bevi score line at
 * the bottom of that column; or, with people's photos, the strip with the note under it. Then the
 * optional "Bev'd it too" line, the foot (heart and comment on the left, Rank it and Want to Try on
 * the right) and the comments.
 *
 * Double-tap anywhere outside the photos likes it (never unlikes; the heart does that). The post's
 * background is a Pressable that only counts taps: two within `DOUBLE_TAP_MS` like. Every control
 * inside (the picture or the strip's tiles, the heart, the comment bubble, Rank, Want to Try,
 * "See more", "View all N comments") is its own Pressable, so it takes the tap itself with no delay:
 * on the web the innermost Pressable handles the `click` and stops it bubbling, and natively the
 * deepest responder wins. The strip sits in a tap sink that swallows taps between and around its
 * tiles, so a double-tap on a photo never likes.
 *
 * Inline comments and the "Bev'd it too" line are plain text, not controls, so a double-tap on them
 * likes like anywhere else outside the photos.
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
  alsoBevdBy,
  alsoBevdCount,
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
  const who = you ? 'You' : actor ? firstName(actor) : '';
  const image = bevImageProps(bev);
  // The Bev's own picture unless the post brings people's photos; an empty list draws neither.
  const media: 'picture' | 'strip' | 'none' = !photos ? 'picture' : photos.length ? 'strip' : 'none';
  const limit = media === 'picture' ? NOTE_SIDE : NOTE_FULL;
  const long = !!note && note.length > limit.max;
  const shown = note && long && !open ? `${note.slice(0, limit.cut).replace(/\s+\S*$/, '')} …` : note;
  const textColor = { color: colors.text };
  const secondary = { color: colors.textSecondary };
  const meta = metaParts(bev, cat?.label, time);
  const beviLine = media === 'picture' ? beviScoreLine(bev) : null;
  const also = alsoBevdParts(alsoBevdBy, alsoBevdCount);
  const social = !!(onFollow || onLike || onComment);
  const hasFoot = social || !!(onRank || onSave);

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
    <Text style={[type.bodyLarge, styles.wrap, textColor]}>
      {shown}
      {long && !open ? <Text style={secondary}> See more</Text> : null}
    </Text>
  ) : null;

  const noteBlock = (where: StyleProp<ViewStyle>): ReactNode =>
    noteText ? (
      long && !open ? (
        // The whole note expands, so "See more" has a note-sized target rather than a 20pt word.
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${shown} See more`}
          style={[where, styles.noteTarget]}
          testID="post-note"
        >
          {noteText}
        </Pressable>
      ) : (
        <View style={where} testID="post-note">
          {noteText}
        </View>
      )
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
        !hasFoot && styles.footless,
        divider && styles.divider,
        style,
      ]}
    >
      <View style={styles.head}>
        <Avatar name={name || who} src={actor?.avatarUrl ?? undefined} size={POST_AVATAR} />
        <View style={styles.headText}>
          {/* A long Bev name wraps to two lines at most, and the bubble keeps its place. */}
          <Text style={[type.heading, styles.regular, textColor]} numberOfLines={2}>
            <Text style={styles.bold}>{who}</Text>
            <Text>{" Bev'd "}</Text>
            <Text style={styles.bold}>{bev.name}</Text>
          </Text>
          <View style={styles.meta} testID="post-meta">
            {cat ? <Icon name={cat.icon} size={16} strokeWidth={2} color={colors.textSecondary} /> : null}
            {/* The brand gives way first: it truncates on its own and " · time" always shows in full. */}
            <View style={styles.metaText}>
              {meta.brand ? (
                <Text style={[type.body, styles.shrink, secondary]} numberOfLines={1} testID="post-meta-brand">
                  {meta.brand}
                </Text>
              ) : null}
              {meta.when ? (
                <Text style={[type.body, styles.keep, secondary]} numberOfLines={1} testID="post-meta-when">
                  {meta.brand ? ' · ' : ''}
                  {/* Its own node, the exact relative time. */}
                  <Text>{meta.when}</Text>
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        {score != null || scoreVariant ? <ScoreBubble score={score} variant={scoreVariant} bucket={bucket ?? undefined} /> : null}
      </View>

      {media === 'picture' ? (
        <View style={styles.body} testID="post-body">
          {/* Top-aligned and no taller than the picture, so the burst stays centred on it when the note runs long. */}
          <View style={styles.picture}>
            <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${bev.name}`} testID="post-picture">
              <BevImage size={POST_PICTURE} src={image.src} art={image.art} alt={bev.name} status={image.status} />
            </Pressable>
            {burst ? <LikeBurst key={burst} /> : null}
          </View>
          {noteText || beviLine ? (
            <View style={styles.side} testID="post-side">
              {noteBlock(null)}
              {beviLine ? (
                <Text style={[type.caption, styles.beviLine, secondary]} testID="post-bevi-score">
                  {beviLine}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : media === 'strip' ? (
        <>
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
                {photos!.map((t, i) => (
                  <Pressable key={i} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${bev.name}`}>
                    <BevImage size={size.bevImageStrip} src={t.src} art={t.art} alt={bev.name} />
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
            {burst ? <LikeBurst key={burst} /> : null}
          </View>
          {noteBlock(styles.noteUnder)}
        </>
      ) : (
        noteBlock(styles.noteUnder)
      )}

      {also ? (
        <View style={styles.also} testID="post-also">
          {/* The names are in the sentence beside it; the stack is decoration for a screen reader. */}
          <View importantForAccessibility="no-hide-descendants" aria-hidden>
            <AvatarStack
              people={alsoBevdBy!.slice(0, ALSO_NAMED).map((p) => ({ name: p.displayName || p.handle, src: p.avatarUrl ?? undefined }))}
              size={24}
              max={ALSO_NAMED}
            />
          </View>
          <Text style={[type.caption, styles.shrink, secondary]}>
            <Text style={styles.bold}>{also.names[0]}</Text>
            {also.names[1] ? (
              <>
                {also.others > 0 ? ', ' : ' and '}
                <Text style={styles.bold}>{also.names[1]}</Text>
              </>
            ) : null}
            {also.others > 0 ? ` and ${also.others} ${also.others === 1 ? 'other' : 'others'}` : ''}
            {" Bev'd it too"}
          </Text>
        </View>
      ) : null}

      {hasFoot ? (
        <View style={styles.foot} testID="post-foot">
          {/* About the post. The group pulls back by the heart's side padding so its glyph lines up with the gutter; a leading pill has no padding to pull back. */}
          <View style={[styles.group, !onFollow && social && styles.socialEdge]} testID="post-social">
            {onFollow ? <FollowPill following={following} name={name || who} onPress={onFollow} /> : null}
            {onLike ? <LikeButton liked={liked} count={likeCount} onPress={onLike} /> : null}
            {onComment ? <CommentButton count={commentCount} onPress={onComment} /> : null}
          </View>
          {/* About the Bev. */}
          {onRank || onSave ? <BevActions name={bev.name} saved={saved} onRank={onRank} onSave={onSave} /> : null}
        </View>
      ) : null}
      {commentCount > INLINE_COMMENTS ? (
        <Pressable
          onPress={onComment}
          disabled={!onComment}
          accessibilityRole="button"
          accessibilityLabel={`View all ${commentCount} comments`}
          style={styles.allComments}
        >
          <Text style={[type.body, secondary]}>{`View all ${commentCount} comments`}</Text>
        </Pressable>
      ) : comments.length ? (
        // Text, not controls: a double-tap here likes the post like anywhere else outside the photos.
        <View style={styles.comments} role="list" aria-label="Comments" testID="feed-post-comments">
          {comments.slice(0, INLINE_COMMENTS).map((c) => (
            <View key={c.id} role="listitem" style={styles.commentRow} testID={`feed-post-comment-${c.id}`}>
              <Avatar name={c.author.displayName || c.author.handle} src={c.author.avatarUrl ?? undefined} size={24} />
              <Text style={[type.body, styles.comment, styles.wrap, textColor]}>
                <Text style={styles.bold}>{c.author.handle}</Text> {c.body}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {burst && media === 'none' ? <LikeBurst key={burst} /> : null}
    </Pressable>
  );
}

/** The burst heart (FeedPost README): 88pt, filled `primary`. */
const BURST = 88;
/** bundle.css `@keyframes bv-like-burst` over 800ms: grow to 1.1 by 20%, settle to 1 by 32%, hold to 70%, fade out. */
const BURST_MS = 800;
const BURST_FROM = 0.4;
const BURST_OVERSHOOT = 1.1;

/**
 * The big heart a double-tap bursts over the Bev's picture or the photo strip (the post's centre
 * with neither). It grows on a slight overshoot, holds and fades within 800ms, transform and opacity
 * only; Reduce Motion leaves the fade alone (bundle.css `bv-like-fade`). Remounted with a new key on
 * every burst.
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
  // The design system's FeedPost: `lg` above, `sm` below, the gutter at the sides.
  post: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.gutter,
    // A double-tap likes, so Safari mustn't zoom on it. react-native-web's Pressable also sets this
    // and a pointer cursor; the post isn't a link, so the cursor goes back to auto.
    ...(Platform.OS === 'web' ? ({ touchAction: 'manipulation', cursor: 'auto' } as ViewStyle) : null),
  },
  // With no foot the 44pt action row's own air is gone, so the post keeps its top padding at the bottom.
  footless: { paddingBottom: spacing.lg },
  divider: { borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, minWidth: 0 },
  // The sentence: the verb regular, the names bold.
  regular: { fontWeight: '400' },
  bold: { fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: HAIRLINE_OFFSET },
  // The brand and " · time" side by side with no gap between them; only the brand shrinks.
  metaText: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  keep: { flexShrink: 0 },
  // `overflow-wrap: anywhere` so a long unbroken word wraps instead of widening the post.
  wrap: Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as TextStyle) : {},
  // The picture, and beside it a column with the note over the Bevi score line.
  body: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, marginTop: spacing.md },
  picture: { alignSelf: 'flex-start' },
  side: { flex: 1, minWidth: 0, justifyContent: 'space-between', gap: spacing.sm, paddingVertical: HAIRLINE_OFFSET },
  // At the bottom of the column, also when there is no note above it.
  beviLine: { marginTop: 'auto' },
  media: { marginTop: spacing.md, marginHorizontal: -spacing.gutter },
  sink: { cursor: 'auto' },
  stripContent: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  noteUnder: { marginTop: spacing.md },
  noteTarget: { minHeight: size.target },
  // The "Bev'd it too" line: the AvatarStack, then the sentence.
  also: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  // The foot: the post's controls on the left, the Bev's on the right.
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.target,
    marginTop: spacing.xs,
  },
  group: { flexDirection: 'row', alignItems: 'center' },
  socialEdge: { marginLeft: -spacing.sm },
  // bundle.css `.bv-post-comments` / `.bv-post-allcomments`.
  comments: { gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.sm },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  // bundle.css `.bv-post-comment-text`: the text starts a little below the avatar's top edge.
  comment: { flex: 1, minWidth: 0, paddingTop: HAIRLINE_OFFSET },
  allComments: { minHeight: size.target, justifyContent: 'center', alignSelf: 'flex-start' },
  burst: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
