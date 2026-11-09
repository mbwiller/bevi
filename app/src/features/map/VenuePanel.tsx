import { ApiError, isApiError, type Bev, type BevSummary, type Bucket, type VenuePin } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useAddWantToTry, useBev, useMe, useRemoveWantToTry, useVenue } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { VenueSheet } from '@/components/VenueSheet';
import { useRecents } from '@/features/add-bev/recents';
import { MIN_CONFIDENCE } from '@/features/lists/copy';
import { useOpenBev } from '@/features/search/BevRows';
import { visibleCategories } from '@/lib/categories';

export const YOUR_SCORE = 'Your score';
export const YOUD_RATE_IT = "You'd rate it";

/**
 * What a Bev's row in a VenueSheet shows: your score if you ranked it (in your bucket's colour), else
 * your prediction when it is confident enough (dotted ring, as on Bev detail), else the Bayesian
 * score with the rating count. Until the Bev's detail loads it is the Bayesian score.
 */
export function venueBevScore(
  bev: BevSummary,
  detail: Pick<Bev, 'myRanking' | 'prediction'> | undefined,
): { score: number | null; variant: 'default' | 'predicted'; bucket?: Bucket; meta?: string } {
  const mine = detail?.myRanking;
  if (mine) return { score: mine.score, variant: 'default', bucket: mine.bucket, meta: YOUR_SCORE };
  const p = detail?.prediction;
  if (p && p.confidence >= MIN_CONFIDENCE) return { score: p.score, variant: 'predicted', meta: YOUD_RATE_IT };
  return { score: bev.bayesScore, variant: 'default' };
}

/** One Bev the venue carries. Like a search result, it reads the Bev's detail for your score and the bookmark. */
function VenueBevRow({ bev, onOpen, onRank }: { bev: BevSummary; onOpen: () => void; onRank: () => void }) {
  const detail = useBev(bev.id);
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();
  const saved = detail.data?.inWantToTry ?? false;
  const s = venueBevScore(bev, detail.data);
  return (
    <BevRow
      bev={bev}
      showImage
      score={s.score}
      scoreVariant={s.variant}
      bucket={s.bucket}
      meta={s.meta}
      count={bev.ratingCount}
      saved={saved}
      onPress={onOpen}
      onRank={onRank}
      onSave={() => (saved ? remove.mutate(bev.id) : add.mutate({ bevId: bev.id }))}
    />
  );
}

export interface VenuePanelProps {
  /** The tapped pin: it fills the header while `venues.get` loads. */
  pin: VenuePin;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The VenueSheet for a pin (M-16): `venues.get(id)` keyed by id and seeded from the pin, the Bevs
 * there as BevRows (Rank it and Want to Try as in search; a tap opens the Bev page), `not_found` as
 * "This spot isn't here anymore", anything else as an ErrorState with Retry.
 */
export function VenuePanel({ pin, onClose, style }: VenuePanelProps) {
  const router = useRouter();
  const q = useVenue(pin.venue.id, pin);
  const me = useMe();
  const { remember } = useRecents(me.data?.id);
  const { rank } = useOpenBev(remember);
  // The server already age-gates the assortment; this keeps the alcoholic three out even if one slips through.
  const allowed = useMemo(() => new Set(visibleCategories(me.data?.canSeeAlcohol ?? false).map((c) => c.id)), [me.data?.canSeeAlcohol]);

  const loading = q.isPlaceholderData || (q.isPending && q.fetchStatus !== 'idle');
  const notFound = isApiError(q.error) && q.error.code === 'not_found';
  const failed = !notFound && q.isError && !q.data;
  // Offline: the query waits (paused) instead of failing; say so rather than loading forever.
  const offline = q.fetchStatus === 'paused' && (!q.data || q.isPlaceholderData);
  const bevs = !loading && q.data ? q.data.bevs.filter((b) => allowed.has(b.categoryId)) : [];
  const detail = q.data && !notFound ? q.data : null;

  return (
    <VenueSheet
      venue={notFound ? null : (detail?.venue ?? pin.venue)}
      openNow={detail?.openNow ?? pin.openNow}
      bevCount={loading ? pin.bevCount : bevs.length}
      loading={loading && !offline}
      notFound={notFound}
      error={failed ? q.error : offline ? OFFLINE : undefined}
      onRetry={() => void q.refetch()}
      onClose={onClose}
      style={style}
    >
      {bevs.length
        ? bevs.map((b) => (
            <VenueBevRow
              key={b.id}
              bev={b}
              onRank={() => rank(b)}
              onOpen={() => {
                remember(b);
                router.push({ pathname: '/bev/[id]', params: { id: b.id } });
              }}
            />
          ))
        : null}
    </VenueSheet>
  );
}

const OFFLINE = new ApiError('network', 'offline: venues.get is paused');
