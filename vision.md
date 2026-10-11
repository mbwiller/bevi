# Bevi — Vision

> Rank every drink you've ever had. Find the next one you'll love.

Bevi is a mobile app for rating and discovering **beverages**, modeled closely on how Beli works for restaurants. Instead of giving a drink a raw score, you compare it against drinks you've already ranked ("better or worse than this one?"), and Bevi works out where it lands on your personal list. From everyone's rankings, Bevi builds a global leaderboard and predicts how much *you* would like a drink you haven't tried.

This document is the source of truth for what we're building. It was distilled from the founding "fried and vibe" session transcript (`conversation.md`).

---

## 1. Core idea

- **The unit is a single beverage product**, not a brand or a store. A can of Coca-Cola and a can of Diet Coca-Cola are two different Bevs. A specific horchata from a specific spot is its own Bev.
- **Ranking is blind and comparative.** You never type a number. You answer quick "higher or lower?" prompts, Tinder-style, and the app places the drink in your list and derives a score from its position.
- **Discovery is personalized.** When you look up a Bev, Bevi shows "We think you'd rate this X/10" based on your tastes and how people like you ranked it.
- **It's social.** Feed of what friends are drinking, followers/following, a leaderboard, and a "Want to Try" list for drinks you spot on someone else's feed.

### Why it works for drinks (and differs from Beli)
Beli avoids an all-time restaurant leaderboard for cultural reasons. For drinks that concern doesn't apply — the fun *is* arguing about the best Bev. So Bevi leans into a **global leaderboard** (overall and per category).

---

## 2. The Bev data model

Every Bev is its own record and **must have a photo**.

| Field | Notes |
|---|---|
| `id` | |
| `name` | e.g. "Diet Coke" |
| `brand` / `maker` | Optional; for a shop-made drink, the shop name |
| `flavor` | e.g. "Cherry", "Original" |
| `category_id` | See categories below |
| `photo_url` | **Transparent / clean background** cutout of the drink, not a square photo with a busy background. This is the Bev's icon everywhere in the app. |
| `nutrition_label_url` | Photo of the nutrition label (optional for shop drinks) |
| `price_tier` | `$` to `$$$$`, like Google Maps. If the price isn't known, **estimate it**. Diet Coke ≈ `$`; specialty horchata ≈ `$$`; expensive alcohol ≈ `$$$`–`$$$$` |
| `price_estimated` | Boolean — true if we guessed the tier |
| `avg_score` | Mean of all users' scores for this Bev |
| `score_stddev` | Standard deviation of those scores (used for normalization) |
| `rating_count` | Number of users who ranked it |
| `created_by` | User who added it (null for seeded Bevs) |
| `created_at` | |

### Photos
- Seeded Bevs: source product images from the web that are consistent in style with clean/transparent backgrounds.
- User-added Bevs: run the user's photo through **background removal** so it matches the rest of the catalog.
- Featured Bevs can use polished generated imagery.

### Categories (initial)
Bevs are partitioned into categories so we can compare like with like and learn per-category tastes:

- Soda
- Diet / zero-sugar soda
- Juice
- Water (still)
- Sparkling water / seltzer
- Energy drinks
- Coffee drinks
- Tea / iced tea
- Boba / milk tea
- Sports drinks
- Smoothies / shakes
- Alcoholic — beer, wine, spirits/cocktails (21+ only)
- Other / regional (horchata, aguas frescas, etc.)

Categories can be refined later; the list just needs to be good enough to group similar drinks.

---

## 3. Adding a Bev

1. User snaps a photo of their drink (or searches).
2. If the Bev **already exists** in the database → go straight to ranking.
3. If it **doesn't exist** → "Add new Bev" flow:
   - Name, flavor, category, brand/shop
   - Photo of the drink (background removed automatically)
   - Photo of the nutrition label (optional)
   - Price tier (user-picked or estimated)
   - New row inserted into the database
4. Then rank it.

Dedupe guardrail: before creating a new Bev, show likely matches ("Did you mean…?") to avoid five copies of the same drink.

---

## 4. The ranking algorithm (Beli-style)

The comparison approach is well known and not hard to implement. Our version:

1. **Gut check.** After trying a Bev, the user picks one of three buckets: *Loved it* / *It was fine* / *Didn't like it*.
2. **Pairwise placement.** Bevi shows the new Bev next to one the user already ranked in that bucket and asks "Which was better?" Using **binary search** over the user's ordered list for that bucket, it finds the exact slot in about log₂(n) comparisons (≈ 4–7 taps even for a long list).
3. **Score from position.** Each bucket maps to a score band: Loved 7–10, Fine 4–7, Didn't like 0–4 (Beli-style; decided 2026-10-09). A Bev's score is interpolated from its position within its bucket. Inserting a new Bev re-spaces scores in that bucket.
4. **Store both** the ordered position and the derived 0–10 score per user per Bev, plus the raw comparisons (useful later for re-ranking and for the recommendation model).

Optional later: periodically re-check a few close pairs to correct drift.

### Global scores
- Per Bev: `avg_score`, `score_stddev`, `rating_count`.
- For the leaderboard, use a **Bayesian average** (pulls Bevs with very few ratings toward the global mean) so one 10/10 from one person doesn't top the chart.

### Normalization
Some users score generously, some harshly. Each user also has a mean and standard deviation across their rankings (overall and **per category**). We convert scores to **z-scores per user** before using them for recommendations so tastes are compared on equal footing.

---

## 5. Recommendations & predicted score

Goal: show "**We think you'd rate this X/10**" on any Bev, and power a **Recommended for you** list. Keep it simple, then layer up as data grows.

### Layer 1 — Category affinity + content similarity (works from day one)
- Learn each user's normalized affinity for each category (their average z-score there).
- Score candidate Bevs by: category affinity + similarity to Bevs the user loved (same category, flavor, brand, price tier) + the Bev's global normalized score.
- Recommend the best-rated Bevs in categories the user likes that they haven't tried.

### Layer 2 — Collaborative filtering (once there are enough users)
- "People who rank the way you do loved this."
- Item-item or user-user similarity on normalized scores; predicted rating = user's mean + weighted average of similar users' deviations for that Bev.
- Later, matrix factorization if the dataset gets big enough to justify it.

### Blend + exploration
- Final prediction is a weighted blend of Layer 1 and Layer 2, with Layer 2's weight growing as `rating_count` and the user's history grow.
- Add a small amount of **randomness / exploration** so users get occasional surprises outside their usual categories and the system learns more about them.

### Cold start
- New user: onboarding asks them to rank a handful of very common Bevs (Coke, Diet Coke, Sprite, LaCroix, Red Bull, etc.) so we have a baseline.
- New Bev: falls back to category and content similarity until it has ratings.

---

## 6. App structure & UI

Look and feel: very close to Beli's layout and gamified energy, with our own **Bevi** identity. Logo: an original wordmark in a similar clean, playful spirit — "Bevi" spelled B-E-V-I. Reference screenshots of Beli will be added to the repo for layout guidance.

### Bottom tabs
1. **Feed** — Venmo-style social feed of friends' recent rankings (Bev photo, who, score, short note). Includes **Featured Bevs** at the top.
2. **Your Lists** — sub-tabs:
   - **Bev'd** — everything you've ranked, in order
   - **Want to Try** — saved Bevs (e.g. you saw Jack rank a boba drink and saved it)
   - **Recommended** — your algorithmic recs with predicted scores
3. **Add Bev** (center) — search the database or add a new Bev, then rank it. Replaces Beli's "search" slot.
4. **Leaderboard** — top Bevs overall and per category, plus a user leaderboard.
5. **Profile** — see below.

### Profile page (bottom-right tab) — must look great
- Top left: user's name
- Top center: circular avatar with initials; handle underneath
- Followers / Following counts
- **Rank on Bevi** (where you sit on the user leaderboard)
- **Streak** (consecutive days with a ranking)
- Three tappable tiles:
  - **Bev'd (count)** → opens Your Lists › Bev'd
  - **Want to Try (count)** → opens Your Lists › Want to Try
  - **Recommended for you** → opens Your Lists › Recommended *(most important link on the page)*
- Below: scrollable feed of the user's past rankings
- Settings in a corner menu (account, sign out). Location features are off; keep a minimal privacy/settings page anyway.

### Bev detail page
Photo, name, flavor, category, price tier, global score + rating count, **your predicted score**, friends who've had it, buttons for "Rank it" and "Want to Try."

---

## 7. Social

- Follow / unfollow users
- Feed of followed users' rankings
- Save any Bev from the feed to Want to Try
- User leaderboard (by number of Bevs ranked, streaks, etc.)

---

## 8. Tech direction

- **Backend:** Supabase — Postgres for data, Auth for accounts (username + password, sign-up gated by a shared invite code; no OAuth, no emails), Storage for photos. Free tier should comfortably cover the first group of users (build for ~20 from day one, with room to grow).
- **App:** Expo (React Native) built for the web, hosted on Vercel and added to the iPhone home screen. No native builds, app stores or Android.
- *Decided 2026-10-11:* web app only, for under 20 friends; replaces the earlier iOS/Android and Google sign-in plan.
- **Images:** background removal on upload (service or on-device model).
- **Recommendations:** start as SQL views/functions in Postgres for Layer 1; move Layer 2 to a scheduled job (Edge Function or small Python worker) when data justifies it.

### Core tables
`users`, `follows`, `categories`, `bevs`, `rankings` (user, bev, bucket, position, score, note, created_at), `comparisons` (user, winner_bev, loser_bev), `want_to_try`, `user_category_stats` (mean, stddev), `streaks`, `featured_bevs`.

---

## 9. Development phases

### Phase 0 — Setup & research
- Find open-source **mobile UI design skills/guidelines** to use as a foundation for the look and feel.
- Collect Beli reference screenshots into `/design/reference`.
- Create the Supabase project and schema.
- Seed the database with common Bevs (with clean-background photos and price tiers).
- Write `CLAUDE.md` files with the model/agent rules below.

### Phase 1 — MVP: rank your Bevs
- Auth + onboarding (rank a starter set)
- Add Bev flow (search existing / create new with photo + background removal)
- Pairwise ranking + scoring
- Your Lists (Bev'd, Want to Try)
- Bev detail page
- Profile page (polished)
- Global leaderboard

### Phase 2 — Social + recommendations
- Follows, Feed, Featured Bevs
- Per-user normalization and category stats
- Layer 1 recommendations + predicted score on Bev pages
- Streaks and user rank

### Phase 3 — Smarter and bigger
- Layer 2 collaborative filtering + blending + exploration
- Per-category leaderboards, "hottest Bevs this month"
- Polish, performance, analytics
- Future business ideas: promoted/featured placements for brands or shops, subscription tier

---

## 10. Sub-agents & model assignment

To avoid burning tokens, each sub-agent gets the cheapest model and effort level that does the job well. Encode these in `CLAUDE.md` / agent definitions so nothing launches on a heavyweight model by default.

| Task | Model | Effort | Why |
|---|---|---|---|
| Overall architecture, schema design, phase planning | Opus | High | Decisions everything else builds on |
| Ranking + recommendation algorithm design and math review | Opus | High | Needs to be correct; mistakes are expensive later |
| Feature implementation (screens, API calls, Supabase queries) | Sonnet | Medium | Bulk of the code; strong and much cheaper |
| UI polish (profile page, feed, Beli-like look) | Sonnet | Medium–High | Design taste + implementation |
| Code review / bug hunting before each phase ships | Sonnet | High | Catches issues without Opus cost |
| Seeding Bev data, finding product images, price-tier estimates | Haiku | Low | Repetitive, high-volume, simple |
| Tests, boilerplate, migrations, docs | Haiku | Low–Medium | Mechanical work |
| Research (UI skill libraries, open-source ranking implementations) | Sonnet | Medium | Search + summarize |

Rules of thumb:
- Default sub-agent model is **Sonnet**, not Opus.
- Escalate to Opus only for design decisions and algorithm correctness.
- Use Haiku for anything that's "do this 200 times."
- One sub-agent per clear deliverable; give it the relevant section of this file instead of the whole repo.

---

## 11. Open questions

- Exact category list and whether alcohol ships in v1 (needs 21+ age gate).
- How to source seed images legally and consistently (manufacturer images, own photos, or generated).
- ~~Score band boundaries for the three buckets.~~ Decided 2026-10-09: Loved 7–10, Fine 4–7, Didn't like 0–4.
- What counts toward "rank on Bevi" — volume, streak, followers, or a mix?
- Moderation for user-added Bevs and photos (duplicates, junk entries).
- Logo and brand colors.
