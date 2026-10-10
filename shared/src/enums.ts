export type Bucket = 1 | 2 | 3; // 1 = didn't like, 2 = fine, 3 = loved
export const BUCKET_LABEL: Record<Bucket, string> = { 1: 'Didn\'t like it', 2: 'It was fine', 3: 'Loved it' };

export type CategoryId =
  | 'soda' | 'diet_soda' | 'juice' | 'water' | 'sparkling_water' | 'energy'
  | 'coffee' | 'tea' | 'boba' | 'sports' | 'smoothie'
  | 'beer' | 'wine' | 'spirits_cocktails' | 'other';

export type PriceTier = 1 | 2 | 3 | 4;

export type FeedEventKind = 'ranked' | 'reranked' | 'want_to_try' | 'followed';

export type BevStatus = 'pending_photo' | 'active' | 'merged' | 'hidden';
