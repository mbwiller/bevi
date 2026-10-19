import type { FeedItem } from '@bevi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useAddWantToTry, useMe, useRemoveWantToTry, useToggleLike, type LikeVars } from '@/api/hooks';
import { keys } from '@/api/keys';
import { categoryById } from '@/lib/categories';

import { FeedPostItem } from './FeedPostItem';
import { likeErrorMessage } from './likeError';

/** What the feed says when a post's comments turn out to be on a post that's gone. */
export const POST_GONE = "That post isn't here anymore.";
/** How long that notice stays. */
const NOTICE_MS = 6000;

/**
 * Everything a list of FeedItems needs to behave like the Feed: like (with per-post errors), Want to
 * Try, Rank, the comments sheet's open post, and the "post is gone" notice. Shared by the Feed and
 * Profile › Activity so they agree. `linkActors: false` drops the avatar link (on that person's own profile).
 */
export function useFeedPostActions({ linkActors = true }: { linkActors?: boolean } = {}) {
  const router = useRouter();
  const me = useMe();
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();
  const qc = useQueryClient();
  // Per post: its latest like tap failed and the heart went back. Said on that post until its next
  // tap, whichever post was tapped since (the mutation's own `error` only knows the latest call).
  const [likeErrors, setLikeErrors] = useState<Record<string, string>>({});
  const onLikeFailed = useCallback(
    (vars: LikeVars, error: unknown) => setLikeErrors((m) => ({ ...m, [vars.id]: likeErrorMessage(error, vars.like) })),
    [],
  );
  const { mutate: toggleLike } = useToggleLike({ onFailed: onLikeFailed });
  const like = useCallback(
    (vars: LikeVars) => {
      setLikeErrors((m) => {
        if (!(vars.id in m)) return m;
        const { [vars.id]: _cleared, ...rest } = m;
        return rest;
      });
      toggleLike(vars);
    },
    [toggleLike],
  );

  // The post whose comments are open, and the notice when one turned out to be gone.
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openComments = useCallback((id: string) => {
    setNotice(null);
    setCommentsFor(id);
  }, []);
  const closeComments = useCallback(() => setCommentsFor(null), []);
  const postGone = useCallback(() => {
    setCommentsFor(null);
    setNotice(POST_GONE);
    // keys.feed() also covers every person's Activity (keys.feedUser).
    void qc.invalidateQueries({ queryKey: keys.feed() });
  }, [qc]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const meId = me.data?.id;
  const canSeeAlcohol = me.data?.canSeeAlcohol ?? false;
  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const you = item.actor.id === meId;
      // §6.17: a friend's beer still shows, but under 21 there's no plus-circle. Your own ranking is already ranked.
      const rankable = !(categoryById(item.bev.categoryId)?.isAlcoholic && !canSeeAlcohol) && !(you && item.type === 'RANKING');
      return (
        <FeedPostItem
          item={item}
          you={you}
          onRank={rankable ? () => router.push({ pathname: '/rank/[bevId]', params: { bevId: item.bev.id } }) : undefined}
          onSave={() =>
            item.inMyWantToTry ? remove.mutate(item.bev.id) : add.mutate({ bevId: item.bev.id, viaUserId: you ? undefined : item.actor.id })
          }
          onLike={() => like({ id: item.id, like: !item.likedByMe })}
          likeError={likeErrors[item.id] ?? null}
          onComment={() => openComments(item.id)}
          onOpenBev={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
          onOpenActor={
            linkActors
              ? () => (you ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: item.actor.id } }))
              : undefined
          }
        />
      );
    },
    [add, remove, like, likeErrors, openComments, router, meId, canSeeAlcohol, linkActors],
  );

  return { renderItem, commentsFor, closeComments, postGone, notice };
}
