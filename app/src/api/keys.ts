// TanStack Query keys for every BeviApi read, in one place (DEVELOPMENT-MATT §3). Keys are
// hierarchical so a prefix invalidates a whole family: `keys.rankings.all` covers listMine,
// listUser and listBucket; `keys.bevs.all` covers detail, search, duplicates and starters.

import type { Bucket, CategoryId, FindDuplicatesInput, RankingSort } from '@bevi/shared';

const root = ['bevi'] as const;

export interface MyRankingsParams {
  bucket?: Bucket;
  categoryId?: CategoryId;
  sort?: RankingSort;
  /** Page size; the cursor is managed by the infinite query. */
  limit?: number;
}

export const keys = {
  all: root,

  session: () => [...root, 'session'] as const,
  appConfig: () => [...root, 'appConfig'] as const,
  checkHandle: (handle: string) => [...root, 'checkHandle', handle] as const,

  me: () => [...root, 'me'] as const,

  users: {
    all: [...root, 'users'] as const,
    detail: (id: string) => [...root, 'users', 'detail', id] as const,
    search: (q: string) => [...root, 'users', 'search', q] as const,
  },

  stats: {
    all: [...root, 'stats'] as const,
    mine: () => [...root, 'stats', 'me'] as const,
    user: (id: string) => [...root, 'stats', 'user', id] as const,
  },

  follows: {
    all: [...root, 'follows'] as const,
    followers: (id: string) => [...root, 'follows', 'followers', id] as const,
    following: (id: string) => [...root, 'follows', 'following', id] as const,
    suggested: () => [...root, 'follows', 'suggested'] as const,
  },

  categories: () => [...root, 'categories'] as const,

  bevs: {
    all: [...root, 'bevs'] as const,
    detail: (id: string) => [...root, 'bevs', 'detail', id] as const,
    search: (q: string, categoryId?: CategoryId) => [...root, 'bevs', 'search', q, categoryId ?? null] as const,
    duplicates: (input: FindDuplicatesInput) => [...root, 'bevs', 'duplicates', input] as const,
    starterCandidates: () => [...root, 'bevs', 'starterCandidates'] as const,
  },

  rankings: {
    all: [...root, 'rankings'] as const,
    mine: (params: MyRankingsParams = {}) => [...root, 'rankings', 'mine', params] as const,
    user: (id: string) => [...root, 'rankings', 'user', id] as const,
    bucket: (bucket: Bucket | undefined) => [...root, 'rankings', 'bucket', bucket ?? null] as const,
  },

  wantToTry: () => [...root, 'wantToTry'] as const,

  feed: () => [...root, 'feed'] as const,
  featured: () => [...root, 'featured'] as const,

  leaderboard: {
    all: [...root, 'leaderboard'] as const,
    bevs: (categoryId?: CategoryId) => [...root, 'leaderboard', 'bevs', categoryId ?? null] as const,
    users: () => [...root, 'leaderboard', 'users'] as const,
  },

  recommendations: (limit?: number) => [...root, 'recommendations', limit ?? null] as const,
  recommendationsAll: [...root, 'recommendations'] as const,
} as const;
