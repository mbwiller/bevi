import type { Comment, Profile } from '@bevi/shared';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { formatRelativeTime } from '@/lib/time';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { TARGET_MIN } from './HitTarget';
import { Skeleton } from './Skeleton';
import { Sheet } from './Sheet';

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
}

/** A web-only CSS property: a long unbroken word wraps instead of widening the sheet. */
const WRAP = (Platform.OS === 'web' ? { overflowWrap: 'anywhere' } : {}) as TextStyle;

/**
 * The post's comments in a 90% Sheet titled "Comments", Instagram-clean: the thread reads oldest at
 * the top and newest just above the composer, like a chat. Each comment: Avatar 32, the bold handle
 * and a relative time in `textSecondary`, then the text; your own end in "Delete" (44pt,
 * `textSecondary`), which asks again inside the row, never in a browser dialog. No likes on comments.
 *
 * The composer is pinned to the bottom: your Avatar 32, a pill "Add a comment…" and Post in `primary`
 * (`textSecondary` and disabled while empty or over 280 characters). The remaining count shows beside
 * Post from 20 left and turns `scoreLow` below zero. Failures land in a caption under it, and the
 * draft stays.
 *
 * The keyboard: iOS Safari doesn't resize the page for it, so the sheet's bottom (a fixed-position
 * Modal) would sit behind the keyboard. `useKeyboardInset` reads how much of the screen the keyboard
 * hides from `visualViewport` and the composer pads itself up by that, less the sheet's own bottom
 * padding, so it rides just above the keyboard while the list above it shrinks.
 */
export function CommentsSheet({
  open = false,
  comments = [],
  me,
  onClose,
  onPost,
  onDelete,
  error,
  posting = false,
  deleting = [],
  loading = false,
  loadError,
  onRetry,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
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
  const keyboard = useKeyboardInset(open);
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  // The Sheet already pads its bottom by `xxl` + the home-indicator inset, which the keyboard covers.
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
    <View style={styles.fill}>
      <FlashList
        key={listKey}
        ref={list}
        data={comments}
        renderItem={renderComment}
        keyExtractor={(c) => c.id}
        extraData={`${confirming ?? ''}|${deleting.join(',')}|${me?.id ?? ''}`}
        ListHeaderComponent={earlier}
        // The first layout is when the end is known; later remounts (earlier comments) stay at the top.
        onLoad={listKey === 0 ? () => list.current?.scrollToEnd({ animated: false }) : undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
      />
    </View>
  ) : (
    <EmptyState icon="message-circle" title="No comments yet" body="Start the conversation." style={styles.empty} />
  );

  return (
    <Sheet open={open} title="Comments" snap={90} onClose={onClose} scroll={false}>
      {thread}
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
        {error ? (
          <Text style={[type.caption, styles.error, { color: colors.scoreLow }]} role="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
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
