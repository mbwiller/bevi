import { bucketForScore, type Bucket } from '@bevi/ranking';

import type { ColorName } from './tokens';

const BUCKET_COLOR: Record<Bucket, ColorName> = {
  LOVED: 'scoreHigh',
  FINE: 'scoreMid',
  DISLIKED: 'scoreLow',
};

/**
 * The colour token for a score. Pass the bucket whenever it is known (the user's own rankings):
 * colour is the bucket. Without one (averages, predictions) the band is taken from the value as
 * displayed (one decimal), as the design system does, so "7.0" is always green; the 7 / 4 edges come
 * from @bevi/ranking's `bucketForScore`, never a local copy.
 */
export function scoreColor(score: number, bucket?: Bucket): ColorName {
  return BUCKET_COLOR[bucket ?? bucketForScore(Math.round(score * 10) / 10)];
}
