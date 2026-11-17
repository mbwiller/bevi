import type { ExplorePost } from '@bevi/shared';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FOLLOW_MUTATION, flattenPages, useExplore, useFollow, useMe, useUnfollow } from '@/api/hooks';
import { categoryById } from '@/lib/categories';

import { ExplorePostItem } from './ExplorePostItem';

/**
 * Who the viewer followed (or unfollowed again) from Explore since its current sequence loaded. The
 * server only serves people you don't follow, so this is the whole follow state of the list.
 *
 * Following someone doesn't take their posts out of the list: the pill turns to "Following" and the
 * posts stay where they are, so nothing jumps under the reader. `settleFollow` marks Explore stale,
 * and the next fresh sequence (pull to refresh, opening Explore again) leaves them out; they're in
 * Your feed by then. That fresh sequence also clears this record, unless a follow is still on its
 * way to the server (the new page may predate it). A failed follow or unfollow goes back.
 */
function useExploreFollows(sequence: unknown) {
  const { mutate: follow } = useFollow();
  const { mutate: unfollow } = useUnfollow();
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const pending = useIsMutating({ mutationKey: FOLLOW_MUTATION }) > 0;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!pendingRef.current) setFollowed((m) => (Object.keys(m).length ? {} : m));
  }, [sequence]);

  const toggle = useCallback(
    (userId: string, following: boolean) => {
      const set = (v: boolean) => setFollowed((m) => ({ ...m, [userId]: v }));
      set(!following);
      (following ? unfollow : follow)(userId, { onError: () => set(following) });
    },
    [follow, unfollow],
  );
  return { followed, toggle };
}

/**
 * The Explore segment of the Feed (M-04): `feed.getExplore` while `enabled`, the posts to show and
 * how to draw one. Under 21, alcoholic Bevs never show: the server leaves them out, and so does this
 * (as BevOfPeriod does), until the profile has loaded too.
 */
export function useExplorePosts(enabled: boolean) {
  const router = useRouter();
  const query = useExplore({ enabled });
  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;
  const posts = useMemo(
    () => flattenPages(query.data).filter((p) => canSeeAlcohol || !categoryById(p.bev.categoryId)?.isAlcoholic),
    [query.data, canSeeAlcohol],
  );
  // A refetch replaces the first page; fetching the next one keeps it.
  const { followed, toggle } = useExploreFollows(query.data?.pages[0]);

  const renderItem = useCallback(
    (item: ExplorePost) => {
      const following = followed[item.actor.id] ?? false;
      return (
        <ExplorePostItem
          item={item}
          following={following}
          onFollow={() => toggle(item.actor.id, following)}
          onOpenBev={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
          onOpenActor={() => router.push({ pathname: '/user/[id]', params: { id: item.actor.id } })}
        />
      );
    },
    [followed, toggle, router],
  );

  return { query, posts, renderItem };
}
