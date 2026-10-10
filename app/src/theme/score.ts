import { bucketForScore, type Bucket } from '@bevi/ranking';

import type { ColorName } from './tokens';

const BUCKET_COLOR: Record<Bucket, ColorName> = {
  LOVED: 'scoreHigh',
  FINE: 'scoreMid',
  DISLIKED: 'scoreLow',
};

/**
 * The colour token for a score. Pass the bucket whenever it is known (the user's own rankings):
 * colour is the bucket, so a Fine Bev near the top edge never turns green. Without one (averages,
 * predictions) the band comes from @bevi/ranking's `bucketForScore` (7 / 4 edges), never a local copy.
 */
export function scoreColor(score: number, bucket?: Bucket): ColorName {
  return BUCKET_COLOR[bucket ?? bucketForScore(score)];
}
