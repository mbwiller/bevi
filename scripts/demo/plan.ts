/**
 * IA-8: the demo world a store reviewer sees, as data.
 *
 * `DEVELOPMENT-ARJUN-IOS.md` IA-8: App Review is a stranger with no invite
 * code who rejects rather than asks, and an app that opens onto empty screens
 * is a Guideline 2.1 rejection. So the demo account has to land on a populated
 * Feed, non-empty lists, a leaderboard with qualifying rows, a profile with a
 * live streak, and enough ranked Bevs for Recommended -- all of it produced by
 * the real RPCs (scripts/demo/seed.ts), none of it special-cased in the app.
 *
 * This file is the plan only: pure, no network, no credentials. It names the
 * people, what each of them ranked and when, who follows whom, and which posts
 * get likes and comments. `buildPlan()` resolves every catalog slug to the Bev
 * id the catalog seed migration gave it and then checks the whole world for
 * the things that would quietly produce a boring or broken demo (a bucket with
 * nothing in it, a leaderboard with nothing eligible, a comment on a post its
 * author cannot see). plan.test.ts runs those checks with no stack at all.
 *
 * THE RULES THIS PLAN HAS TO RESPECT, and where they come from:
 *
 *  - Every Bev is a real catalog row (`data/catalog/bevs.csv`). We invent
 *    people, never Bevs: a Bev that is not in the catalog would also have to
 *    be moderated, iconed and deduped.
 *  - `MIN_RATERS` (@bevi/ranking) is how many raters a Bev needs before it is
 *    eligible for the leaderboard, and `MIN_N_USER` is how many rankings the
 *    viewer needs before `getRecommendations()` returns anything at all
 *    (packages/api/src/recs.ts). Both are read, never guessed.
 *  - Everyone here is over 21 (IS-3's default: alcohol visible), so the three
 *    alcoholic categories appear, and `submit_ranking`'s own age guard lets
 *    them rank a beer. Flipping IS-3 changes the age-rating answers; see the
 *    comment on `BIRTH_DATES` below.
 *  - Every person's most recent ranking is TODAY. `touch_streak` recomputes a
 *    streak from `ranking_events` at submit time, and the seeder backdates
 *    those events as it goes, so the last submission of each person is what
 *    leaves a correct `streaks` row behind. A plan whose last day is not 0
 *    would leave a streak that is right only by accident.
 *  - A like or a comment is only possible on a post the author can see
 *    (`feed_event_visible`: own, or a followee's), so every like and comment
 *    here is checked against the follow graph.
 *  - Nothing here may collide with `app/scripts/check-bundle.mjs`'s forbidden
 *    strings or look like the jest FakeApi's fixture people (`tester`,
 *    `friend_a`...). plan.test.ts reads that list out of check-bundle.mjs and
 *    fails if a name, handle, note or comment ever drifts into it.
 */

import { MIN_N_USER, MIN_RATERS } from "@bevi/ranking";

import { catalogBevId, loadBevRows, loadCategories } from "../catalog/catalog.ts";

/**
 * `shared/src/enums.ts`'s Bucket, and the smallint the database stores
 * (3/2/1 = LOVED/FINE/DISLIKED, as `packages/api`'s `bucketToDb` maps it).
 * Mirrored rather than imported: `@bevi/shared` uses extensionless relative
 * imports, which `node --experimental-strip-types` cannot resolve.
 */
export type Bucket = "LOVED" | "FINE" | "DISLIKED";
export const BUCKET_DB: Record<Bucket, 1 | 2 | 3> = { LOVED: 3, FINE: 2, DISLIKED: 1 };

/** `HANDLE_PATTERN` and `RESERVED_HANDLES` from `shared/src/enums.ts`, mirrored for the same reason. */
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
const RESERVED_HANDLES = ["admin", "bevi", "support", "null"];

/** `submit_ranking` caps a note at 140 characters; `add_comment` caps a body at 280. */
const NOTE_MAX = 140;
const COMMENT_MAX = 280;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The handle the review notes will carry. Not a fixture name, not reserved, not in check-bundle's list. */
export const DEMO_HANDLE = "review_guest";

/**
 * IS-3, the demo account's age: **over 21, so alcohol is visible**, which is
 * the decision's current default and what the age-rating questionnaire (IM-12)
 * is answered against. `profiles.birth_date` drives `can_see_alcohol`
 * server-side (`viewer_is_adult()`: birth_date <= today - 21 years), and the
 * three alcoholic categories are hidden for anyone under it. Changing these
 * dates to an under-21 date is not a cosmetic change: it changes what the
 * reviewer sees AND the answers we give Apple about age rating, so it is a
 * decision to reopen IS-3 with, not a tweak.
 */
const BIRTH_DATES: Record<string, string> = {
  review_guest: "1994-03-08",
  nadia_okafor: "1991-07-19",
  theo_brandt: "1988-11-02",
  maren_ruiz: "1996-01-27",
  desmond_lau: "1993-05-14",
  ivy_castellanos: "1990-09-30",
};

/**
 * Every seeded person's timezone, so the day keys below are exact.
 * `touch_streak` and `effective_streak` bucket `ranking_events` into days in
 * the profile's own timezone; this script computes its day offsets in UTC, and
 * setting the profiles to UTC is what makes the two agree. (The default,
 * America/Los_Angeles, would put a late-UTC run's "today" on the previous
 * local day and silently break the streak run by one.)
 */
export const DEMO_TIMEZONE = "UTC";

interface PlannedRanking {
  /** A `data/catalog/bevs.csv` slug. */
  slug: string;
  bucket: Bucket;
  /** Whole days back from the run. Every person's last entry is 0; see the header. */
  daysAgo: number;
  /** Shows on the feed card. <= 140 chars (`submit_ranking`). */
  note?: string;
}

interface PersonSpec {
  handle: string;
  displayName: string;
  /** Chronological, oldest first: the seeder appends in this order, so this is also the bucket order. */
  rankings: PlannedRanking[];
  /** Want to Try; must be Bevs this person has not ranked (`submit_ranking` clears a want row). */
  wantToTry?: string[];
}

/** A post, named by who made it and which Bev it was: the seeder resolves it to a `feed_events` id. */
export interface PostRef {
  actor: string;
  slug: string;
}

interface SocialSpec {
  by: string;
  post: PostRef;
  /** Hours after the post, clamped to "before now" by the seeder. */
  hoursAfter: number;
}

type LikeSpec = SocialSpec;
interface CommentSpec extends SocialSpec {
  body: string;
}

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------
// Invented, ordinary names: none of them is a check-bundle forbidden string
// and none of them reads like a test fixture. The demo account is first.

const PEOPLE: PersonSpec[] = [
  {
    handle: DEMO_HANDLE,
    displayName: "Review Guest",
    // Seven consecutive days, 6 -> 0, so the profile shows a streak of 7 and
    // "ranked today". 14 Bevs, every bucket occupied, well past MIN_N_USER.
    rankings: [
      { slug: "coca-cola-classic", bucket: "FINE", daysAgo: 6 },
      { slug: "mexican-coca-cola", bucket: "LOVED", daysAgo: 6, note: "Cane sugar, glass bottle. Hard to go back after this one." },
      { slug: "diet-coke", bucket: "DISLIKED", daysAgo: 5 },
      { slug: "lacroix-pamplemousse", bucket: "LOVED", daysAgo: 5 },
      { slug: "arizona-green-tea", bucket: "FINE", daysAgo: 4 },
      { slug: "dunkin-bottled-iced-coffee-original", bucket: "LOVED", daysAgo: 4, note: "Cold, cheap, and in every corner shop." },
      { slug: "monster-energy-original", bucket: "DISLIKED", daysAgo: 3 },
      { slug: "gatorade-lemon-lime", bucket: "FINE", daysAgo: 3 },
      { slug: "tiger-sugar-brown-sugar-boba-milk-tea", bucket: "LOVED", daysAgo: 2, note: "Worth the queue once a week." },
      { slug: "fiji-natural-artesian-water", bucket: "FINE", daysAgo: 2 },
      { slug: "pure-leaf-unsweetened", bucket: "DISLIKED", daysAgo: 1 },
      { slug: "celsius-sparkling-orange", bucket: "FINE", daysAgo: 1 },
      { slug: "modelo-especial", bucket: "LOVED", daysAgo: 0, note: "With tacos, nothing else is close." },
      { slug: "generic-margarita", bucket: "FINE", daysAgo: 0 },
    ],
    wantToTry: ["red-bull-tropical", "gts-kombucha-gingerade", "la-marca-prosecco", "jamba-juice-mango-a-go-go"],
  },
  {
    handle: "nadia_okafor",
    displayName: "Nadia Okafor",
    rankings: [
      { slug: "starbucks-frappuccino-mocha", bucket: "LOVED", daysAgo: 8 },
      { slug: "arizona-green-tea", bucket: "LOVED", daysAgo: 7 },
      { slug: "monster-energy-original", bucket: "DISLIKED", daysAgo: 6 },
      { slug: "coca-cola-classic", bucket: "FINE", daysAgo: 5 },
      { slug: "kung-fu-tea-classic-milk-tea", bucket: "LOVED", daysAgo: 4, note: "Half sugar, extra ice, every time." },
      { slug: "red-bull-original", bucket: "DISLIKED", daysAgo: 3 },
      { slug: "lacroix-lime", bucket: "FINE", daysAgo: 2 },
      { slug: "vita-coco-coconut-water-original", bucket: "FINE", daysAgo: 1 },
      { slug: "dunkin-bottled-iced-coffee-original", bucket: "LOVED", daysAgo: 0, note: "The morning one. Not negotiable." },
      { slug: "mountain-dew", bucket: "DISLIKED", daysAgo: 0 },
    ],
    wantToTry: ["tiger-sugar-brown-sugar-boba-milk-tea", "liquid-death-sparkling-severed-lime"],
  },
  {
    handle: "theo_brandt",
    displayName: "Theo Brandt",
    rankings: [
      { slug: "dr-pepper", bucket: "LOVED", daysAgo: 9, note: "Twenty-three flavours and all of them right." },
      { slug: "coca-cola-classic", bucket: "FINE", daysAgo: 8 },
      { slug: "diet-coke", bucket: "DISLIKED", daysAgo: 7 },
      { slug: "guinness-draught", bucket: "LOVED", daysAgo: 5 },
      { slug: "sprite", bucket: "FINE", daysAgo: 4 },
      { slug: "lacroix-coconut", bucket: "DISLIKED", daysAgo: 3 },
      { slug: "mexican-coca-cola", bucket: "LOVED", daysAgo: 2 },
      { slug: "gatorade-lemon-lime", bucket: "FINE", daysAgo: 1 },
      { slug: "pure-leaf-unsweetened", bucket: "DISLIKED", daysAgo: 1 },
      { slug: "modelo-especial", bucket: "LOVED", daysAgo: 0 },
    ],
    wantToTry: ["la-marca-prosecco"],
  },
  {
    handle: "maren_ruiz",
    displayName: "Maren Ruiz",
    rankings: [
      { slug: "lacroix-pamplemousse", bucket: "LOVED", daysAgo: 7, note: "The only flavour I buy by the case." },
      { slug: "coca-cola-classic", bucket: "DISLIKED", daysAgo: 6 },
      { slug: "gts-kombucha-gingerade", bucket: "LOVED", daysAgo: 5 },
      { slug: "tropicana-orange-juice-original", bucket: "FINE", daysAgo: 4 },
      { slug: "dr-pepper", bucket: "DISLIKED", daysAgo: 3 },
      { slug: "liquid-death-sparkling-severed-lime", bucket: "LOVED", daysAgo: 2 },
      { slug: "arizona-green-tea", bucket: "FINE", daysAgo: 2 },
      { slug: "monster-energy-mango-loco", bucket: "DISLIKED", daysAgo: 1 },
      { slug: "la-marca-prosecco", bucket: "FINE", daysAgo: 1 },
      { slug: "fiji-natural-artesian-water", bucket: "LOVED", daysAgo: 0, note: "Yes, water can be Loved. Fight me." },
    ],
    wantToTry: ["celsius-sparkling-orange", "naked-berry-blast"],
  },
  {
    handle: "desmond_lau",
    displayName: "Desmond Lau",
    rankings: [
      { slug: "celsius-sparkling-orange", bucket: "LOVED", daysAgo: 6, note: "Three a week, which is probably two too many." },
      { slug: "red-bull-original", bucket: "FINE", daysAgo: 5 },
      { slug: "pure-leaf-unsweetened", bucket: "DISLIKED", daysAgo: 4 },
      { slug: "monster-energy-zero-ultra", bucket: "LOVED", daysAgo: 3 },
      { slug: "coke-zero-sugar", bucket: "FINE", daysAgo: 2 },
      { slug: "fiji-natural-artesian-water", bucket: "DISLIKED", daysAgo: 2 },
      { slug: "tiger-sugar-brown-sugar-boba-milk-tea", bucket: "LOVED", daysAgo: 1 },
      { slug: "dr-pepper", bucket: "FINE", daysAgo: 1 },
      { slug: "generic-house-red-cabernet-sauvignon", bucket: "DISLIKED", daysAgo: 0 },
      { slug: "kung-fu-tea-classic-milk-tea", bucket: "LOVED", daysAgo: 0 },
    ],
    wantToTry: ["modelo-especial"],
  },
  {
    handle: "ivy_castellanos",
    displayName: "Ivy Castellanos",
    rankings: [
      { slug: "tropicana-orange-juice-original", bucket: "LOVED", daysAgo: 8 },
      { slug: "monster-energy-original", bucket: "DISLIKED", daysAgo: 7 },
      { slug: "la-marca-prosecco", bucket: "LOVED", daysAgo: 6, note: "The birthday default." },
      { slug: "lacroix-pamplemousse", bucket: "FINE", daysAgo: 5 },
      { slug: "coke-zero-sugar", bucket: "DISLIKED", daysAgo: 4 },
      { slug: "naked-berry-blast", bucket: "LOVED", daysAgo: 3 },
      { slug: "mexican-coca-cola", bucket: "FINE", daysAgo: 2 },
      { slug: "liquid-death-sparkling-severed-lime", bucket: "DISLIKED", daysAgo: 1 },
      { slug: "arizona-green-tea", bucket: "FINE", daysAgo: 1 },
      { slug: "generic-margarita", bucket: "LOVED", daysAgo: 0 },
    ],
    wantToTry: ["kung-fu-tea-classic-milk-tea"],
  },
];

/**
 * Who follows whom. The demo account follows all five (that is what fills its
 * Feed) and all five follow it back (that is what lets them like and comment
 * on its posts), plus a few friend-to-friend edges so the Friends leaderboard
 * and "also Bev'd" are not a star graph.
 */
const FOLLOWS: Array<[string, string]> = [
  [DEMO_HANDLE, "nadia_okafor"],
  [DEMO_HANDLE, "theo_brandt"],
  [DEMO_HANDLE, "maren_ruiz"],
  [DEMO_HANDLE, "desmond_lau"],
  [DEMO_HANDLE, "ivy_castellanos"],
  ["nadia_okafor", DEMO_HANDLE],
  ["nadia_okafor", "maren_ruiz"],
  ["nadia_okafor", "theo_brandt"],
  ["theo_brandt", DEMO_HANDLE],
  ["theo_brandt", "desmond_lau"],
  ["theo_brandt", "nadia_okafor"],
  ["maren_ruiz", DEMO_HANDLE],
  ["maren_ruiz", "nadia_okafor"],
  ["maren_ruiz", "ivy_castellanos"],
  ["desmond_lau", DEMO_HANDLE],
  ["desmond_lau", "theo_brandt"],
  ["desmond_lau", "nadia_okafor"],
  ["ivy_castellanos", DEMO_HANDLE],
  ["ivy_castellanos", "maren_ruiz"],
  ["ivy_castellanos", "theo_brandt"],
];

const LIKES: LikeSpec[] = [
  { by: DEMO_HANDLE, post: { actor: "nadia_okafor", slug: "dunkin-bottled-iced-coffee-original" }, hoursAfter: 2 },
  { by: DEMO_HANDLE, post: { actor: "theo_brandt", slug: "modelo-especial" }, hoursAfter: 1 },
  { by: DEMO_HANDLE, post: { actor: "maren_ruiz", slug: "fiji-natural-artesian-water" }, hoursAfter: 1 },
  { by: DEMO_HANDLE, post: { actor: "desmond_lau", slug: "kung-fu-tea-classic-milk-tea" }, hoursAfter: 2 },
  { by: DEMO_HANDLE, post: { actor: "ivy_castellanos", slug: "generic-margarita" }, hoursAfter: 3 },
  { by: "nadia_okafor", post: { actor: DEMO_HANDLE, slug: "modelo-especial" }, hoursAfter: 2 },
  { by: "nadia_okafor", post: { actor: DEMO_HANDLE, slug: "tiger-sugar-brown-sugar-boba-milk-tea" }, hoursAfter: 5 },
  { by: "nadia_okafor", post: { actor: "maren_ruiz", slug: "lacroix-pamplemousse" }, hoursAfter: 6 },
  { by: "theo_brandt", post: { actor: DEMO_HANDLE, slug: "modelo-especial" }, hoursAfter: 1 },
  { by: "theo_brandt", post: { actor: DEMO_HANDLE, slug: "mexican-coca-cola" }, hoursAfter: 9 },
  { by: "theo_brandt", post: { actor: "desmond_lau", slug: "monster-energy-zero-ultra" }, hoursAfter: 4 },
  { by: "maren_ruiz", post: { actor: DEMO_HANDLE, slug: "lacroix-pamplemousse" }, hoursAfter: 3 },
  { by: "maren_ruiz", post: { actor: "nadia_okafor", slug: "arizona-green-tea" }, hoursAfter: 7 },
  { by: "desmond_lau", post: { actor: DEMO_HANDLE, slug: "celsius-sparkling-orange" }, hoursAfter: 2 },
  { by: "desmond_lau", post: { actor: "theo_brandt", slug: "dr-pepper" }, hoursAfter: 8 },
  { by: "desmond_lau", post: { actor: "nadia_okafor", slug: "kung-fu-tea-classic-milk-tea" }, hoursAfter: 5 },
  { by: "ivy_castellanos", post: { actor: DEMO_HANDLE, slug: "generic-margarita" }, hoursAfter: 2 },
  { by: "ivy_castellanos", post: { actor: "maren_ruiz", slug: "la-marca-prosecco" }, hoursAfter: 4 },
  { by: "ivy_castellanos", post: { actor: "theo_brandt", slug: "mexican-coca-cola" }, hoursAfter: 6 },
];

/** Sentence case, no emoji, Bev / Bev'd / Want to Try: the design system's voice. */
const COMMENTS: CommentSpec[] = [
  { by: "theo_brandt", post: { actor: DEMO_HANDLE, slug: "modelo-especial" }, hoursAfter: 2, body: "Correct answer with tacos. Try the Negra next." },
  { by: "nadia_okafor", post: { actor: DEMO_HANDLE, slug: "modelo-especial" }, hoursAfter: 4, body: "Noted for Friday." },
  { by: "maren_ruiz", post: { actor: DEMO_HANDLE, slug: "lacroix-pamplemousse" }, hoursAfter: 5, body: "Pamplemousse is the only right one. The coconut is a trap." },
  { by: "desmond_lau", post: { actor: DEMO_HANDLE, slug: "celsius-sparkling-orange" }, hoursAfter: 3, body: "You have been converted. Welcome." },
  { by: "ivy_castellanos", post: { actor: DEMO_HANDLE, slug: "generic-margarita" }, hoursAfter: 3, body: "Fresh lime or it does not count." },
  { by: DEMO_HANDLE, post: { actor: "nadia_okafor", slug: "dunkin-bottled-iced-coffee-original" }, hoursAfter: 3, body: "Agreed, and it is half the price of the other one." },
  { by: DEMO_HANDLE, post: { actor: "maren_ruiz", slug: "fiji-natural-artesian-water" }, hoursAfter: 2, body: "Water in the Loved bucket is a bold call." },
  { by: DEMO_HANDLE, post: { actor: "theo_brandt", slug: "dr-pepper" }, hoursAfter: 20, body: "Still cannot name a single one of the twenty-three." },
  { by: "ivy_castellanos", post: { actor: "maren_ruiz", slug: "la-marca-prosecco" }, hoursAfter: 6, body: "This is the house pour at mine too." },
];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedBev {
  slug: string;
  bevId: string;
  name: string;
  categoryId: string;
  isAlcoholic: boolean;
}

export interface ResolvedRanking {
  bev: ResolvedBev;
  bucket: Bucket;
  bucketDb: 1 | 2 | 3;
  daysAgo: number;
  note: string | null;
  /** When the seeder will backdate this submission's rows to. */
  at: Date;
}

export interface ResolvedPerson {
  handle: string;
  displayName: string;
  birthDate: string;
  timezone: string;
  isDemo: boolean;
  rankings: ResolvedRanking[];
  wantToTry: ResolvedBev[];
}

export interface ResolvedPost {
  actor: string;
  bev: ResolvedBev;
}

export interface ResolvedLike {
  by: string;
  post: ResolvedPost;
  at: Date;
}

export interface ResolvedComment extends ResolvedLike {
  body: string;
}

export interface Plan {
  /** When the plan was built: every timestamp in it is relative to this. */
  now: Date;
  demoHandle: string;
  people: ResolvedPerson[];
  follows: Array<[string, string]>;
  likes: ResolvedLike[];
  comments: ResolvedComment[];
  /** Counts worth printing, and what the plan promises the demo account will show. */
  summary: {
    people: number;
    rankings: number;
    follows: number;
    likes: number;
    comments: number;
    wantToTry: number;
    /** Bevs with at least MIN_RATERS raters: the ones the leaderboard can show. */
    leaderboardEligible: number;
    demoRankings: number;
    demoStreakDays: number;
    alcoholicBevs: number;
  };
}

function fail(message: string): never {
  throw new Error(`demo plan: ${message}`);
}

/** Midnight UTC, `daysAgo` days before `now`. */
function dayStart(now: Date, daysAgo: number): number {
  const d = new Date(now.getTime() - daysAgo * DAY_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * A plausible wall-clock time for a submission: early afternoon UTC, an hour
 * apart when there are several on the same day.
 *
 * The cap is what makes a run early in the UTC day still correct. Today's
 * entries have to stay (a) in the past, (b) in plan order, and (c) on today's
 * UTC date -- crossing back over midnight would move the event to yesterday
 * and break the streak run by one. So they are spread across whatever is left
 * of today, strictly increasing, and never before midnight.
 */
function rankingTime(now: Date, daysAgo: number, indexInDay: number, index: number, total: number): Date {
  const base = dayStart(now, daysAgo) + (13 + indexInDay) * 60 * 60 * 1000;
  const todayStart = dayStart(now, 0);
  const room = now.getTime() - todayStart;
  const cap = todayStart + Math.floor((room * (index + 1)) / (total + 1));
  return new Date(Math.min(base, cap));
}

/** `hoursAfter` the post, never in the future and never before the post. */
function reactionTime(now: Date, post: Date, hoursAfter: number): Date {
  const t = post.getTime() + hoursAfter * 60 * 60 * 1000;
  return new Date(Math.max(post.getTime(), Math.min(t, now.getTime() - 1000)));
}

function yearsBetween(birthDate: string, now: Date): number {
  const b = new Date(`${birthDate}T00:00:00Z`);
  let years = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
}

/**
 * Resolves the plan above against `data/catalog/` and checks it. Every failure
 * is a `throw`: this is the repository's own data, so a bad plan is a bug to
 * fix here, never something to seed half of.
 */
export function buildPlan(now: Date = new Date()): Plan {
  const alcoholic = new Set(loadCategories().filter((c) => c.isAlcoholic).map((c) => c.id));
  const catalog = new Map<string, ResolvedBev>();
  for (const row of loadBevRows()) {
    catalog.set(row.slug, {
      slug: row.slug,
      bevId: catalogBevId(row.slug),
      name: row.name,
      categoryId: row.category,
      isAlcoholic: alcoholic.has(row.category),
    });
  }

  const bev = (slug: string, where: string): ResolvedBev =>
    catalog.get(slug) ?? fail(`${where}: no catalog Bev with slug "${slug}" (data/catalog/bevs.csv)`);

  // ---- people --------------------------------------------------------------
  const handles = new Set<string>();
  const people: ResolvedPerson[] = PEOPLE.map((spec) => {
    if (!HANDLE_PATTERN.test(spec.handle)) fail(`handle "${spec.handle}" does not match ${HANDLE_PATTERN}`);
    if (RESERVED_HANDLES.includes(spec.handle)) fail(`handle "${spec.handle}" is reserved`);
    if (handles.has(spec.handle)) fail(`handle "${spec.handle}" appears twice`);
    handles.add(spec.handle);

    const birthDate = BIRTH_DATES[spec.handle] ?? fail(`no birth date for "${spec.handle}"`);
    const age = yearsBetween(birthDate, now);
    // IS-3: everyone here is an adult, so alcohol is visible and
    // submit_ranking's age guard lets a beer through.
    if (age < 21) fail(`"${spec.handle}" would be ${age}: every seeded person must be over 21 (IS-3)`);

    if (spec.rankings.length === 0) fail(`"${spec.handle}" ranks nothing`);
    const days = spec.rankings.map((r) => r.daysAgo);
    for (let i = 1; i < days.length; i += 1) {
      if ((days[i] as number) > (days[i - 1] as number)) {
        fail(`"${spec.handle}" rankings must be chronological (oldest first); day ${days[i]} follows ${days[i - 1]}`);
      }
    }
    if (days[days.length - 1] !== 0) {
      fail(`"${spec.handle}" must have ranked something today, so touch_streak leaves a correct streak behind`);
    }

    const perDay = new Map<number, number>();
    const seen = new Set<string>();
    const rankings = spec.rankings.map((r, i): ResolvedRanking => {
      if (seen.has(r.slug)) fail(`"${spec.handle}" ranks "${r.slug}" twice (rankings are unique per user)`);
      seen.add(r.slug);
      if (r.note !== undefined && (r.note.length === 0 || r.note.length > NOTE_MAX)) {
        fail(`"${spec.handle}" note on "${r.slug}" must be 1..${NOTE_MAX} characters`);
      }
      const indexInDay = perDay.get(r.daysAgo) ?? 0;
      perDay.set(r.daysAgo, indexInDay + 1);
      return {
        bev: bev(r.slug, spec.handle),
        bucket: r.bucket,
        bucketDb: BUCKET_DB[r.bucket],
        daysAgo: r.daysAgo,
        note: r.note ?? null,
        at: rankingTime(now, r.daysAgo, indexInDay, i, spec.rankings.length),
      };
    });

    const wantToTry = (spec.wantToTry ?? []).map((slug) => {
      if (seen.has(slug)) fail(`"${spec.handle}" wants to try "${slug}" but also ranked it`);
      return bev(slug, `${spec.handle} wantToTry`);
    });

    return {
      handle: spec.handle,
      displayName: spec.displayName,
      birthDate,
      timezone: DEMO_TIMEZONE,
      isDemo: spec.handle === DEMO_HANDLE,
      rankings,
      wantToTry,
    };
  });

  const demo = people.find((p) => p.isDemo) ?? fail(`no person with the demo handle "${DEMO_HANDLE}"`);

  // The demo account carries the screens: every bucket occupied, enough
  // rankings for Recommended, and a streak that is not zero.
  for (const bucket of ["LOVED", "FINE", "DISLIKED"] as Bucket[]) {
    if (!demo.rankings.some((r) => r.bucket === bucket)) fail(`the demo account's ${bucket} bucket is empty`);
  }
  if (demo.rankings.length < MIN_N_USER) {
    fail(`the demo account has ${demo.rankings.length} rankings; getRecommendations() needs at least MIN_N_USER (${MIN_N_USER})`);
  }
  if (demo.wantToTry.length === 0) fail("the demo account's Want to Try is empty");

  // The streak is the run of consecutive days ending today (streak_from_days).
  const demoDays = [...new Set(demo.rankings.map((r) => r.daysAgo))].sort((a, b) => a - b);
  let demoStreakDays = 0;
  for (const d of demoDays) {
    if (d !== demoStreakDays) break;
    demoStreakDays += 1;
  }
  if (demoStreakDays < 2) fail(`the demo account's streak would be ${demoStreakDays}; it must not be zero or trivial`);

  // ---- follows -------------------------------------------------------------
  const followEdges = new Set<string>();
  for (const [follower, followee] of FOLLOWS) {
    if (!handles.has(follower)) fail(`follow by unknown handle "${follower}"`);
    if (!handles.has(followee)) fail(`follow of unknown handle "${followee}"`);
    if (follower === followee) fail(`"${follower}" cannot follow itself`);
    const key = `${follower}>${followee}`;
    if (followEdges.has(key)) fail(`duplicate follow ${key}`);
    followEdges.add(key);
  }
  for (const p of people) {
    if (p.isDemo) continue;
    if (!followEdges.has(`${DEMO_HANDLE}>${p.handle}`)) fail(`the demo account must follow "${p.handle}" or its feed misses them`);
  }

  // ---- posts, likes, comments ---------------------------------------------
  const postAt = new Map<string, Date>();
  for (const p of people) for (const r of p.rankings) postAt.set(`${p.handle}|${r.bev.slug}`, r.at);

  const resolvePost = (spec: SocialSpec, kind: string): { post: ResolvedPost; at: Date } => {
    if (!handles.has(spec.by)) fail(`${kind} by unknown handle "${spec.by}"`);
    const at = postAt.get(`${spec.post.actor}|${spec.post.slug}`);
    if (at === undefined) fail(`${kind} by "${spec.by}": "${spec.post.actor}" never ranked "${spec.post.slug}", so there is no post`);
    // feed_event_visible: own post, or a followee's. Anything else is a
    // BEVI_NOT_FOUND at seed time and an invisible row if it ever got in.
    if (spec.by !== spec.post.actor && !followEdges.has(`${spec.by}>${spec.post.actor}`)) {
      fail(`${kind}: "${spec.by}" does not follow "${spec.post.actor}", so that post is not visible to them`);
    }
    return { post: { actor: spec.post.actor, bev: bev(spec.post.slug, kind) }, at: reactionTime(now, at, spec.hoursAfter) };
  };

  const likeKeys = new Set<string>();
  const likes = LIKES.map((spec): ResolvedLike => {
    const key = `${spec.by}|${spec.post.actor}|${spec.post.slug}`;
    if (likeKeys.has(key)) fail(`duplicate like ${key}`);
    likeKeys.add(key);
    const { post, at } = resolvePost(spec, "like");
    return { by: spec.by, post, at };
  });

  const comments = COMMENTS.map((spec): ResolvedComment => {
    const body = spec.body.trim();
    if (body.length < 1 || body.length > COMMENT_MAX) fail(`comment by "${spec.by}" must be 1..${COMMENT_MAX} characters`);
    const { post, at } = resolvePost(spec, "comment");
    return { by: spec.by, post, at, body };
  });

  if (!likes.some((l) => l.post.actor === DEMO_HANDLE)) fail("no one likes any of the demo account's posts");
  if (!comments.some((c) => c.post.actor === DEMO_HANDLE)) fail("no one comments on any of the demo account's posts");
  if (!comments.some((c) => c.by === DEMO_HANDLE)) fail("the demo account comments on nothing");

  // ---- the leaderboard needs eligible rows ---------------------------------
  const ratersPerBev = new Map<string, number>();
  for (const p of people) for (const r of p.rankings) ratersPerBev.set(r.bev.slug, (ratersPerBev.get(r.bev.slug) ?? 0) + 1);
  const leaderboardEligible = [...ratersPerBev.values()].filter((n) => n >= MIN_RATERS).length;
  if (leaderboardEligible < 10) {
    fail(`only ${leaderboardEligible} Bev(s) would reach MIN_RATERS (${MIN_RATERS}); the leaderboard would look broken`);
  }

  const alcoholicBevs = new Set(
    people.flatMap((p) => p.rankings.filter((r) => r.bev.isAlcoholic).map((r) => r.bev.slug)),
  ).size;
  // IS-3 says alcohol is visible to the reviewer, so there has to be some.
  if (alcoholicBevs === 0) fail("no alcoholic Bev is ranked, so IS-3's 'alcohol visible' is untestable");

  return {
    now,
    demoHandle: DEMO_HANDLE,
    people,
    follows: FOLLOWS,
    likes,
    comments,
    summary: {
      people: people.length,
      rankings: people.reduce((n, p) => n + p.rankings.length, 0),
      follows: FOLLOWS.length,
      likes: likes.length,
      comments: comments.length,
      wantToTry: people.reduce((n, p) => n + p.wantToTry.length, 0),
      leaderboardEligible,
      demoRankings: demo.rankings.length,
      demoStreakDays,
      alcoholicBevs,
    },
  };
}

/** Every string this plan would write into the database, for the forbidden-string check. */
export function planStrings(plan: Plan): string[] {
  const out: string[] = [];
  for (const p of plan.people) {
    out.push(p.handle, p.displayName);
    for (const r of p.rankings) if (r.note) out.push(r.note);
  }
  for (const c of plan.comments) out.push(c.body);
  return out;
}
