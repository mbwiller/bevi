import type { Bucket } from '@bevi/shared';

import { formatScore } from '@/lib/format';

/** A bucket as a list name ("#3 in Loved"), after the design system's band names. */
export const BUCKET_NAME: Readonly<Record<Bucket, string>> = {
  LOVED: 'Loved',
  FINE: 'Fine',
  DISLIKED: "Didn't like",
};

/** Toast after a `conflict`: the bucket changed on the server, so placement starts over (§6.9). */
export const CONFLICT_NOTICE = "Your list changed, let's redo this one";
/** After a `validation` error that isn't the note: a client bug, so start over the same way. */
export const VALIDATION_NOTICE = "That didn't go through, let's redo this one";

/** "#4 of 31 in Loved": where a Bev sits, `position` 0 = best, `bucketSize` counting the Bev itself. */
export function placeLine(position: number, bucketSize: number, bucket: Bucket): string {
  return `#${position + 1} of ${bucketSize} in ${BUCKET_NAME[bucket]}`;
}

/** "#4 of 31 in Loved · 8.9" from `submitRanking`'s `{ ranking, bucketSize }`. */
export function rankLine(position: number, bucketSize: number, bucket: Bucket, score: number): string {
  return `${placeLine(position, bucketSize, bucket)} · ${formatScore(score)}`;
}

/** Where an incumbent sits in the fetched list: "#3 in Loved". */
export function incumbentLabel(orderedIds: readonly string[], bevId: string, bucket: Bucket): string | undefined {
  const i = orderedIds.indexOf(bevId);
  return i < 0 ? undefined : `#${i + 1} in ${BUCKET_NAME[bucket]}`;
}
