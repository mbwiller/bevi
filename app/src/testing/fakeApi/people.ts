// TEST-ONLY fixture people for the in-memory FakeApi. Neutral, obviously synthetic names: nothing
// here ships in the app (src/testing/** is never imported by production code; see
// src/api/__tests__/test-double-isolation.test.ts). Every Bev id is a real catalog slug from
// data/catalog/bevs.csv; every user id is `user-<handle>`.

import type { CategoryId } from '@bevi/shared';

/** An alcoholic catalog Bev the suites use for `age_restricted`. */
export const ALCOHOLIC_BEV_ID = 'modelo-especial';

export interface FixtureUser {
  handle: string;
  displayName: string;
  password: string;
  birthdate: string;
  timezone: string;
  /** Days before the fixture build that the account was created. */
  joinedDaysAgo: number;
  /** Category → taste in [-1, 1]; unlisted categories are neutral. */
  taste: Partial<Record<CategoryId, number>>;
  rankings: number;
  /** Consecutive days (ending today) with at least one ranking. */
  streakDays: number;
  follows: string[];
  wantToTry: { bevId: string; via?: string }[];
}

/** The account most suites sign in as. */
export const ME = { handle: 'tester', password: 'tester-pass-1', displayName: 'Test User' } as const;
/** Under 21: exercises `canSeeAlcohol: false`. */
export const MINOR = { handle: 'minor_user', displayName: 'Minor User' } as const;
/** A user ME follows. */
export const FRIEND = { handle: 'friend_a', displayName: 'Friend A' } as const;

/** The invite code the FakeApi accepts on sign-up. */
export const FAKE_INVITE_CODE = 'test-invite';

const PASSWORD = 'test-pass-1';

export const FIXTURE_USERS: readonly FixtureUser[] = [
  {
    handle: ME.handle, displayName: ME.displayName, password: ME.password, birthdate: '1996-04-12',
    timezone: 'America/New_York', joinedDaysAgo: 40, taste: { soda: 0.4, coffee: 0.6, diet_soda: -0.5, sparkling_water: 0.2 },
    rankings: 12, streakDays: 2, follows: ['friend_a', 'friend_b', 'friend_c', 'friend_d'],
    wantToTry: [
      { bevId: 'tiger-sugar-brown-sugar-boba-milk-tea', via: 'friend_d' },
      { bevId: 'olipop-strawberry-vanilla' },
      { bevId: 'topo-chico-original', via: 'friend_b' },
    ],
  },
  {
    handle: FRIEND.handle, displayName: FRIEND.displayName, password: PASSWORD, birthdate: '1994-09-30',
    timezone: 'America/New_York', joinedDaysAgo: 60, taste: { soda: 0.8, diet_soda: -0.6, energy: 0.3, juice: 0.2 },
    rankings: 55, streakDays: 5, follows: ['friend_b', 'friend_c', ME.handle, 'friend_e'],
    wantToTry: [{ bevId: 'gong-cha-taro-milk-tea', via: 'friend_d' }, { bevId: 'reeds-ginger-beer' }],
  },
  {
    handle: 'friend_b', displayName: 'Friend B', password: PASSWORD, birthdate: '1998-02-14',
    timezone: 'America/Los_Angeles', joinedDaysAgo: 55, taste: { sparkling_water: 0.9, tea: 0.6, soda: -0.4, diet_soda: 0.3 },
    rankings: 40, streakDays: 3, follows: [FRIEND.handle, 'friend_d', ME.handle],
    wantToTry: [{ bevId: 'health-ade-kombucha-pink-lady-apple' }],
  },
  {
    handle: 'friend_c', displayName: 'Friend C', password: PASSWORD, birthdate: '1992-11-03',
    timezone: 'America/Chicago', joinedDaysAgo: 50, taste: { energy: 0.7, sports: 0.6, soda: 0.3, water: -0.3 },
    rankings: 45, streakDays: 0, follows: [FRIEND.handle, MINOR.handle],
    wantToTry: [{ bevId: 'ghost-energy-sour-patch-kids-redberry', via: MINOR.handle }],
  },
  {
    handle: 'friend_d', displayName: 'Friend D', password: PASSWORD, birthdate: '2000-06-21',
    timezone: 'America/Los_Angeles', joinedDaysAgo: 45, taste: { coffee: 0.8, boba: 0.9, tea: 0.4, soda: -0.2 },
    rankings: 35, streakDays: 1, follows: ['friend_b', ME.handle, 'friend_e'],
    wantToTry: [{ bevId: 'la-colombe-draft-latte-oat-milk' }],
  },
  {
    handle: MINOR.handle, displayName: MINOR.displayName, password: PASSWORD, birthdate: '2008-05-01',
    timezone: 'America/Denver', joinedDaysAgo: 30, taste: { energy: 0.6, sports: 0.8, soda: 0.5, juice: 0.3 },
    rankings: 35, streakDays: 4, follows: ['friend_c', FRIEND.handle],
    wantToTry: [{ bevId: 'celsius-sparkling-orange', via: 'friend_c' }],
  },
  {
    handle: 'friend_e', displayName: 'Friend E', password: PASSWORD, birthdate: '1990-01-08',
    timezone: 'Europe/London', joinedDaysAgo: 35, taste: { beer: 0.6, wine: 0.7, spirits_cocktails: 0.4, diet_soda: 0.5, soda: -0.3 },
    rankings: 40, streakDays: 0, follows: ['friend_d', FRIEND.handle],
    wantToTry: [{ bevId: 'cutwater-spirits-margarita' }],
  },
];

export interface FixtureFeatured {
  bevId: string;
  tagline: string;
}

/** Featured Bevs (one alcoholic, to exercise the age filter). No hero images. */
export const FIXTURE_FEATURED: readonly FixtureFeatured[] = [
  { bevId: 'olipop-vintage-cola', tagline: 'Featured test Bev one' },
  { bevId: 'topo-chico-original', tagline: 'Featured test Bev two' },
  { bevId: 'kung-fu-tea-classic-milk-tea', tagline: 'Featured test Bev three' },
  { bevId: ALCOHOLIC_BEV_ID, tagline: 'Featured test Bev, 21+' },
];
