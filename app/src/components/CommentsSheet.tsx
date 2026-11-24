import type { Comment, Profile } from '@bevi/shared';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Announce } from './Announce';
import { formatRelativeTime } from '@/lib/time';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { IconButton } from './IconButton';
import { TARGET_MIN } from './HitTarget';
import { Skeleton } from './Skeleton';
import { Sheet, SheetScrollView } from './Sheet';

/** Comments longer than this are refused (the contract's `comments.add` limit). */
export const COMMENT_MAX = 280;
/** The remaining count shows from this many characters left. */
export const COMMENT_COUNTDOWN = 20;

/** Characters as the server counts them (`char_length` of the trimmed body: code points, not UTF-16 units). */
export function commentLength(draft: string): number {
  return Array.from(draft.trim()).length;
}

const characters = (n: number) => `${n} character${n === 1 ? '' : 's'}`;

export interface CommentsSheetProps {
  open?: boolean;
  /** The thread, oldest first (the newest sits just above the composer). */
  comments?: Comment[];
  /** The viewer: the composer's avatar, and "Delete" on their own comments. */
  me?: Pick<Profile, 'id' | 'displayName' | 'avatarUrl'>;
  onClose?: () => void;
  /**
   * Posts the trimmed draft. The composer clears when it returns or resolves to anything but
   * `false`; `false` (the post failed) keeps the text to try again.
   */
  onPost?: (body: string) => Promise<boolean> | boolean | void;
  /** Deletes one of your comments, after an in-sheet confirm. */
  onDelete?: (id: string) => void;
  /**
   * Opens the More menu of someone else's comment (Report comment, Block account): an ellipsis at
   * the end of the row. Never on your own comments, which end in Delete. Without it no row has one.
   */
  onMore?: (comment: Comment) => void;
  /** Why the last post or delete failed, in a `scoreLow` caption under the composer. */
  error?: string | null;
  /** A post is in flight: Post is disabled. */
  posting?: boolean;
  /** Comments being deleted: their Delete is disabled. */
  deleting?: readonly string[];
  /** The thread is loading: Skeleton rows instead of the list. */
  loading?: boolean;
  /** The thread didn't load: ErrorState with Retry instead of the list. */
  loadError?: unknown;
  onRetry?: () => void;
  /** Older comments exist: "Load earlier comments" at the top of the thread. */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  /**
   * A sheet that opens over this one (the More menu's Report / Block). Rendered inside this sheet's
   * Modal, not beside it: on iOS a Modal presents from the nearest view controller, and a second
   * Modal presented from the screen that is already presenting this one is refused.
   */
  children?: ReactNode;
}

/** A web-only CSS property: a long unbroken word wraps instead of widening the sheet. */
const WRAP = (Platform.OS === 'web' ? { overflowWrap: 'anywhere' } : {}) as TextStyle;

/** Within this far of the last comment, the thread counts as showing its end (pt). */
const NEAR_END = 24;

/**
 * The post's comments in a Sheet titled "Comments", Instagram-clean. It opens at 60% of the screen,
 * a little above the middle; its top drags up to the whole screen and back, and from either height
 * a swipe down closes it (Sheet's `expand`). On a phone the thread moves the sheet too: a drag down
 * while it shows its first comment, and a drag up while the sheet is at 60%.
 *
 * The thread reads oldest at the top and newest just above the composer, like a chat. Each comment:
 * Avatar 32, the bold handle and a relative time in `textSecondary`, then the text; your own end in
 * "Delete" (44pt, `textSecondary`), which asks again inside the row, never in a browser dialog. No
 * likes on comments.
 *
 * The composer is the Sheet's footer, on the bottom edge of the screen at either height: your
 * Avatar 32, a pill "Add a comment…" and Post in `primary` (`textSecondary` and disabled while empty
 * or over 280 characters). The remaining count shows beside Post from 20 left and turns `scoreLow`
 * below zero. Failures land in a caption under it, and the draft stays.
 *
 * The keyboard: the sheet takes the whole screen while it is up. iOS Safari doesn't resize the page
 * for it, so the sheet's bottom (a fixed-position Modal) would sit behind the keyboard. On the web
 * `useKeyboardInset` reads how much of the screen the keyboard hides from `visualViewport` and the
 * composer pads itself up by that, less the sheet's own bottom padding, so it rides just above the
 * keyboard while the list above it shrinks. On native the Sheet raises its own panel (and shrinks
 * it) by the keyboard, so the composer needs nothing.
 */
export function CommentsSheet({
  open = false,
  comments = [],
  me,
  onClose,
  onPost,
  onDelete,
  onMore,
  error,
  posting = false,
  deleting = [],
  loading = false,
  loadError,
  onRetry,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  children,
}: CommentsSheetProps) {
  const { colors, elevation } = useTheme();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const list = useRef<FlashListRef<Comment>>(null);
  // Focus follows the delete confirm: into its Cancel when it opens, back to the row's Delete after
  // Cancel, so a keyboard or screen-reader user never drops to the page body.
  const cancelRef = useRef<View>(null);
  const deleteRefs = useRef(new Map<string, View>());
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus?.();
    } else if (refocus.current) {
      deleteRefs.current.get(refocus.current)?.focus?.();
      refocus.current = null;
    }
  }, [confirming]);
  // Web only: there the Sheet can't see the keyboard (iOS Safari pans the visual viewport), so the
  // composer lifts itself. On native the Sheet raises its whole panel above the keyboard, so the
  // keyboard is counted there once and the composer adds nothing.
  const keyboard = useKeyboardInset(open && Platform.OS === 'web');
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  // The web Sheet already pads its bottom by `xxl` + the home-indicator inset, which the keyboard covers.
  const lift = keyboard > 0 ? Math.max(0, keyboard - spacing.xxl - safeBottom + spacing.sm) : 0;

  // Each opening starts with an empty composer and no pending confirm (the sheet is reused across posts).
  useEffect(() => {
    if (!open) return;
    setDraft('');
    setConfirming(null);
  }, [open]);

  const body = draft.trim();
  const left = COMMENT_MAX - commentLength(draft);
  const canPost = !!body && left >= 0 && !posting;

  // FlashList keeps its cells in creation order, so earlier comments loaded above would sit after
  // the later ones in the DOM (and in a screen reader's reading order) though drawn above them. When
  // the thread grows at the top, the list remounts in order; it was scrolled to the top to tap "Load
  // earlier comments" and stays there, now on the earliest ones.
  const firstId = comments[0]?.id;
  const [listKey, setListKey] = useState(0);
  const [prevFirstId, setPrevFirstId] = useState(firstId);
  if (firstId !== prevFirstId) {
    setPrevFirstId(firstId);
    if (prevFirstId && comments.findIndex((c) => c.id === prevFirstId) > 0) setListKey((k) => k + 1);
  }

  // How far the thread is scrolled, for the Sheet: at its top, a drag down on it moves the sheet.
  const scrollTop = useSharedValue(0);
  // Whether the thread shows its end, and how tall its window was: the sheet's two heights give the
  // thread two, and a thread read at its end stays at its end when the height changes.
  const atEnd = useRef(true);
  const threadHeight = useRef(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollTop.value = contentOffset.y;
    atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_END;
  };
  const onThreadLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    const was = threadHeight.current;
    threadHeight.current = h;
    // Taller: the new room opened below the last comment, so glide down to it. Shorter: the end went
    // under the composer, unseen, so be there at once.
    if (was && h !== was && atEnd.current) list.current?.scrollToEnd({ animated: h > was });
  };
  // Nothing is scrolled until a thread says so: each opening, and a thread with no list (empty, loading, failed).
  const listed = !loading && !loadError && comments.length > 0;
  useEffect(() => {
    if (open && listed) return;
    scrollTop.value = 0;
    atEnd.current = true;
    threadHeight.current = 0;
  }, [open, listed, scrollTop]);

  // Keep the newest comment in view: on first load and whenever one is added at the bottom (not when
  // earlier ones load above).
  const newestId = comments[comments.length - 1]?.id;
  useEffect(() => {
    if (!newestId) return;
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(t);
  }, [newestId]);

  const post = async () => {
    if (!canPost) return;
    const result = onPost?.(body);
    const ok = result instanceof Promise ? await result : result;
    if (ok !== false) setDraft('');
  };

  const renderComment = ({ item }: { item: Comment }) => {
    const mine = !!me && item.author.id === me.id;
    const asking = confirming === item.id;
    const busy = deleting.includes(item.id);
    return (
      <View style={styles.row} testID={`comment-row-${item.id}`}>
        <Avatar name={item.author.displayName || item.author.handle} src={item.author.avatarUrl ?? undefined} size={32} />
        <View style={styles.text}>
          <Text style={[type.body, { color: colors.text }]}>
            <Text style={styles.bold}>{item.author.handle}</Text>
            <Text style={{ color: colors.textSecondary }}>{`  ${formatRelativeTime(item.createdAt)}`}</Text>
          </Text>
          <Text style={[type.body, WRAP, { color: colors.text }]} testID="comment-body">
            {item.body}
          </Text>
          {asking ? (
            <View style={styles.confirm}>
              <Text style={[type.body, styles.confirmText, { color: colors.text }]} accessibilityLiveRegion="polite">
                Delete this comment?
              </Text>
              <Pressable
                ref={cancelRef}
                onPress={() => {
                  refocus.current = item.id;
                  setConfirming(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel, keep comment"
                style={styles.textButton}
              >
                <Text style={[type.body, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirming(null);
                  onDelete?.(item.id);
                }}
                accessibilityRole="button"
                accessibilityLabel="Delete comment"
                style={styles.textButton}
              >
                <Text style={[type.body, styles.strong, { color: colors.scoreLow }]}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {mine && !asking ? (
          <Pressable
            ref={(el) => {
              if (el) deleteRefs.current.set(item.id, el);
              else deleteRefs.current.delete(item.id);
            }}
            onPress={() => setConfirming(item.id)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Delete your comment: ${item.body}`}
            accessibilityState={{ disabled: busy }}
            style={styles.textButton}
          >
            <Text style={[type.body, { color: colors.textSecondary }]}>Delete</Text>
          </Pressable>
        ) : null}
        {!mine && onMore ? (
          <IconButton icon="ellipsis" size={size.icon - spacing.xs} label={`More actions, comment by @${item.author.handle}`} onPress={() => onMore(item)} style={styles.more} />
        ) : null}
      </View>
    );
  };

  const earlier = hasEarlier ? (
    <Pressable
      onPress={onLoadEarlier}
      disabled={loadingEarlier}
      accessibilityRole="button"
      accessibilityLabel="Load earlier comments"
      accessibilityState={{ busy: loadingEarlier }}
      style={styles.earlier}
    >
      <Text style={[type.body, { color: colors.textSecondary }]}>
        {loadingEarlier ? 'Loading earlier comments…' : 'Load earlier comments'}
      </Text>
    </Pressable>
  ) : null;

  const thread = loading ? (
    <View style={[styles.fill, styles.listContent]} testID="comments-loading">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton variant="circle" width={32} height={32} />
          <Skeleton variant="text" lines={2} style={styles.text} />
        </View>
      ))}
    </View>
  ) : loadError ? (
    <ErrorState error={loadError} onRetry={onRetry} style={styles.fill} />
  ) : comments.length ? (
    <View style={styles.fill} onLayout={onThreadLayout}>
      <FlashList
        key={listKey}
        ref={list}
        data={comments}
        renderItem={renderComment}
        keyExtractor={(c) => c.id}
        extraData={`${confirming ?? ''}|${deleting.join(',')}|${me?.id ?? ''}|${onMore ? 'more' : ''}`}
        ListHeaderComponent={earlier}
        // The first layout is when the end is known; later remounts (earlier comments) stay at the top.
        onLoad={listKey === 0 ? () => list.current?.scrollToEnd({ animated: false }) : undefined}
        // Its scroll waits for the sheet to say whose touch it is (Sheet's `scrollTop`).
        renderScrollComponent={SheetScrollView}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
      />
    </View>
  ) : (
    <EmptyState icon="message-circle" title="No comments yet" body="Start the conversation." style={styles.empty} />
  );

  const composer = (
    <View style={{ paddingBottom: lift }} testID="comment-composer">
      <View style={[styles.composer, { borderTopColor: colors.border }]}>
        {me ? <Avatar name={me.displayName} src={me.avatarUrl ?? undefined} size={32} /> : null}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void post()}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Add a comment"
          aria-invalid={left < 0 ? true : undefined}
          enterKeyHint="send"
          submitBehavior="submit"
          // react-native-web still reads blurOnSubmit (not submitBehavior): keep the keyboard up after Return posts.
          {...({ blurOnSubmit: false } as object)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            type.bodyLarge,
            styles.input,
            { color: colors.text, backgroundColor: colors.surface, borderColor: focused ? colors.primary : colors.borderStrong },
            focused && { boxShadow: elevation.focusRing },
          ]}
        />
        {left <= COMMENT_COUNTDOWN ? (
          <Text
            style={[type.caption, styles.count, { color: left < 0 ? colors.scoreLow : colors.textSecondary }]}
            accessibilityLabel={left < 0 ? `${characters(-left)} over` : `${characters(left)} left`}
            accessibilityLiveRegion="polite"
          >
            {left}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void post()}
          disabled={!canPost}
          accessibilityRole="button"
          accessibilityLabel="Post"
          accessibilityState={{ disabled: !canPost }}
          style={styles.post}
        >
          <Text style={[type.body, styles.strong, { color: canPost ? colors.primary : colors.textSecondary }]}>Post</Text>
        </Pressable>
      </View>
      <Announce text={error} />
      {error ? (
        <Text style={[type.caption, styles.error, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Sheet open={open} title="Comments" snap={60} expand onClose={onClose} scroll={false} footer={composer} scrollTop={scrollTop}>
      {thread}
      {children}
    </Sheet>
  );
}

// bundle.css `.bv-comment-*` and `.bv-composer-*`.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingHorizontal: spacing.gutter },
  empty: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: 0 },
  text: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  strong: { fontWeight: '600' },
  textButton: { ...TARGET_MIN, paddingHorizontal: spacing.xs },
  // Hangs into the row's end so the glyph lines up with the gutter; the row's own vertical padding makes room.
  more: { marginRight: -spacing.sm, marginVertical: -spacing.sm },
  confirm: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: spacing.sm },
  confirmText: { marginRight: spacing.xs },
  earlier: { minHeight: size.target, alignItems: 'center', justifyContent: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: size.target,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    borderWidth: 1,
    borderRadius: radius.pill,
    outlineWidth: 0,
  },
  count: { fontVariant: ['tabular-nums'] },
  post: { ...TARGET_MIN },
  error: { marginTop: spacing.xs, paddingHorizontal: spacing.gutter },
});
