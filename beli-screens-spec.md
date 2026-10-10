# Restaurant-Ranking App — Screen Spec (from Beli screenshots)

This file describes 12 screenshots of the Beli app (iOS) so Claude Code can rebuild the same screens and behavior. Save the screenshots next to this file as `screens/01-home.png` … `screens/12-feed.png` (names listed below) so Claude Code can look at them while building.

> Build note: recreate the layout and features, but use your own app name, logo and placeholder photos. Don't copy Beli's wordmark or other users' photos.

---

## Part 1 — Screenshot labels and descriptions

### 01 — Home (new-user state) → `screens/01-home.png`
- **Header:** serif wordmark "beli" (dark teal), calendar icon, bell icon with red badge "4", hamburger menu.
- **Search bar:** grey pill, "Search a restaurant, member, etc."
- **Quick-action pills (dark teal, white text):** Reserve now (calendar icon), Order (shopping-bag icon), Recs Nearby (location-arrow icon). Row scrolls horizontally.
- **Invite card:** "You have 4 invites left!" / "Unlock features as friends join (0/5)". Horizontal row of 5 rounded-square line-art icons with captions:
  1. Average Scores — small card reading "9.5 Average Score"
  2. Dish Search — serving cloche over a plate
  3. Res sharing — paper airplane over a calendar
  4. Stealth Mode — bag with a keyhole lock
  5. Social Links — two people outlines
  Full-width teal button "Invite friends".
- **FEATURED LISTS** + "See all" link. Horizontal carousel of large photo cards with dark gradient and white text:
  - "Top 10 Seattle Takeout — You've been to 1 of 10" — photo: Margherita-style pizza with charred crust and basil in a cardboard box.
  - "Top 10 Seattle Late Night — You've been to 0 of 10" — photo: spicy red crawfish topped with cilantro and sesame seeds.
  - Third card cut off (plated dish, possibly pasta).
- **YOUR FEED** header (empty below).
- **Bottom tab bar (all screens):** Feed (newspaper), Your Lists (bulleted list), Search (filled teal circle with +, center), Leaderboard (trophy), Profile (circle avatar with initials "AC"). Active tab label is bold.

### 02 — Profile (top) → `screens/02-profile-top.png`
- Header: user's full name (bold, left), share icon, hamburger.
- Large circular avatar with initials "AC" (light grey fill).
- `@username`, "Member since August 2026", teal "+ Add School" link.
- Stats row: 7 Followers · 9 Following · #594761 Rank on Beli.
- Buttons: Edit profile, Share profile, small dropdown (▼).
- List rows with icon, label, count, chevron:
  - ✓ circle — **Been** — 60
  - filled bookmark — **Want to Try** — 12
  - heart circle — **Recs for You**
- Two stat cards: trophy "Rank on Beli #594761"; teal flame/drop "Current Streak 9 weeks".
- Goal card: "Set your 2026 goal — You've tried 60 spots so far in 2026! What's your goal for the year?" with gold trophy illustration and pill choices 80 / 100 / 150 / Customize.

### 03 — Profile → Activity tab (Angel) → `screens/03-activity-angel.png`
- Stat cards and goal card at top (same as 02), then tabs: **Activity** (active, underlined) · Taste Profile · Guides.
- Activity post: avatar "AC", "**You** ranked **Angel**", fork-knife icon · Jackson Heights, Queens, repeat icon "2 visits", score bubble **9.5** (green text in white circle).
- Horizontal photo strip (rounded corners):
  1. Sizzling cast-iron platter of charred chicken/tikka with onions and peppers on foil.
  2. Bowl of yellow curry topped with microgreens, with a bowl of basmati rice.
  3. (cut off) Steel thali tray with chickpea curry (chana) and paneer.
- "**Notes:** dude went again with my mom and she pulled out a sleeper with the paneer paratha…" (truncated).

### 04 — Activity (ZiZi + bookmark) → `screens/04-activity-zizi.png`
- Post: "You ranked **ZiZi**", Chelsea, Manhattan, 1 visit, score **8.7**.
- Photos: (1) table spread — puffy golden bread, plate of shawarma/meat over hummus, herb salad on flatbread, glass of mint water; (2) tiramisu-style dessert in a glass coupe with a spoon.
- Notes: "lowkey israeli, still fire tho. overnight lamb was pretty exceptional. shawarma was very very good. tiramisu had a little kick to it. free house shot …See more".
- "2 likes"; action row: heart, comment bubble, paper-plane share; light-green check circle on right (= you've been).
- Timestamp "Wednesday".
- Next post: "You bookmarked **Kidilum**", Flatiron District, Manhattan — no photo; actions + plus-circle (add to list) and filled teal bookmark.

### 05 — Your Lists → Recs tab → `screens/05-lists-recs.png` (screenshot 11 is a duplicate)
- Title "MY LISTS", share icon, "•••". Dropdown "All ⌄".
- Tabs: Been · Want to Try · **Recs** (active) · Guides · More ⌄.
- Filter pills: filter icon with badge "3" (active, tinted), City ⌄, Reserve, Order, Open now, … (scrolls).
- Sort: "↓↑ Distance", search icon right.
- Rows: name (bold), "$$ • Category", category icon • neighborhood, distance, plus-circle + outline bookmark. Score bubble with small dark-teal badge = number of ratings.
  - The Summer Club — $$ • Bar — cocktail icon • Long Island City, Queens — 0.3 mi — 7.0 (362)
  - Lady M — $$$ • Dessert — ice-cream icon • Long Island City, Queens — 0.4 mi — 8.3 (198)
  - Nostos NYC — $$$ • Greek — Sutton Place, Manhattan — 7.2 (58) — grey note "Unfortunately, there are no tables available through our online partner for your requested date" + OpenTable logo.
- Floating "View Map" pill button (map icon).
- Sticky bottom bar: "👥 2 • Today • All Day ✎" (party size/date/time for reservations).
- (Phone status bar shows an unrelated live sports score — ignore.)

### 06 — Your Lists → Been tab → `screens/06-lists-been.png`
- Sort: "↓↑ Score". Numbered rows ranked by your score:
  1. Bongos — $ • Caribbean, Cuban, Jamaican — Phinney Ridge, Seattle, WA — 2403 mi • Open • Closes 9:00 PM — **10.0**
  2. Magnolia Bakery — $$ • Bakery, Dessert, American — croissant icon • West Village — 3.0 mi • Open • Closes 11:00 PM — **lock icon** (score hidden)
  3. Glace NY — $$ • Ice Cream, Dessert — Carnegie Hill — 1.9 mi • Closed • Opens 12:00 PM Sat — **lock icon**
  4. Dhamaka — $$$ • Indian — Lower East Side — **9.9**

### 07 — Your Lists → Want to Try tab → `screens/07-lists-want.png`
- Dismissible card: cloud-upload icon, "Already have a want to try list or map?", teal button "Import a list", ✕ close.
- Rows (filled teal bookmark = saved):
  - Montagu's Gusto — $$ • American, Cafe, Sandwiches — Murray Hill — 1.3 mi • Closed • Opens 9:30 AM Sat — 7.3 (5k)
  - Mariscos El Submarino — $$ • Mexican, Seafood — Greenpoint, Brooklyn — 1.6 mi • Open • Closes 10:00 PM — 8.8 (8k)
- View Map button, sticky reservation bar.

### 08 — Search → `screens/08-search.png`
- Wordmark left, grey circular ✕ close right.
- Tabs: **Restaurants** (storefront icon, active, teal underline) · Members (people icon).
- Inputs: "Search restaurant, cuisine, occasion"; location field "Current Location" with pin and ✕.
- Pills: Reserve now, Order, Recs (heart), Trending (arrow), …
- **Recents** list (clock icon, name, neighborhood, ✕): Angel, ZiZi, Wan Waan, Angel, Red Chilli.
- Section header "Places you may have been in New York, NY".

### 09 — Activity (bookmarks + Wan Waan) → `screens/09-activity-wanwaan.png`
- "You bookmarked Kidilum" (Flatiron), "You bookmarked Shukette" (Chelsea) — each with action row and filled bookmark, "Wednesday".
- "You ranked **Wan Waan**", Chelsea, 1 visit, **9.2**. Photo: bowl of coconut curry with green beans and red chili, plate of fried rice with sliced grilled steak and herbs, side of rice.

### 10 — Profile → Taste Profile tab → `screens/10-taste-profile.png`
- Deep indigo/purple share card: "LAST 30 DAYS", "Top 66% Diner", pin "Seattle", big stats **12** Restaurants · **23** Cuisines, "More active than 34% of diners in Seattle", white wordmark at bottom, share icon.
- Monthly calendar card: "‹ Oct 2026", share icon, stats 4 Spots ranked · 7 Cuisines · 1 City. 7-column grid (S M T W T F S). Days with a ranked visit show a rounded food-photo thumbnail with the date on top (3, 5, 7, 8). Today (9) has a teal outline.

### 11 — Duplicate of 05 (Recs tab).

### 12 — Feed (with friends) → `screens/12-feed.png`
- Header + search + pills as in 01.
- Composer row: your avatar + grey pill "Ask your friends for recs".
- Friend post: photo avatar, "**Jahnavi** bookmarked **Yubu**", East Village — actions, "5 hours ago".
- Friend post: "**Ajit** ranked **Bánh by Lauren** with **Rhea**", croissant icon • Two Bridges, 1 visit, score **6.7** in **yellow/amber** text. Photo: slice of green pandan honeycomb cake and macarons in clear bags with round branded stickers on a wood table.

---

## Part 2 — Design system

| Token | Value (approx.) | Use |
|---|---|---|
| `primary` | `#154F5C` dark teal | pills, buttons, wordmark, active tab, badges |
| `primaryTint` | `#E8EEF2` | active filter pill background |
| `scoreHigh` | `#2E9E5B` green | scores ≥ 7.0 |
| `scoreMid` | `#E8B423` amber | scores 4.0–6.9 |
| `scoreLow` | `#D9534F` red | scores < 4.0 |
| `badgeRed` | `#E05A55` | notification count |
| `tasteCard` | `#332E80` indigo | Taste Profile share card |
| `text` | `#111` / secondary `#8A8A8E` | |
| `border` | `#E3E3E6` | cards, pill outlines, dividers |
| `surface` | `#FFFFFF`, inputs `#EDEDED` | |

- Fonts: serif for the wordmark only; clean sans (SF Pro / Inter) everywhere else. Section headers in caps with tracking ("FEATURED LISTS").
- Shapes: fully rounded pills (radius 999), cards radius ~16, photos radius ~14, avatars circular.
- Score bubble: 56–64px white circle, grey border, score in colored bold text; optional dark-teal mini badge bottom-right with rating count (362, 5k).
- Icons: outline line icons (Lucide or SF Symbols): heart, message-circle, send, plus-circle, bookmark, check-circle, utensils, cocktail, ice-cream, croissant, repeat, clock, map, trophy, flame.

## Part 3 — Data model

```ts
User        { id, name, username, initials, avatarUrl?, memberSince, school?, followers, following, rank, streakWeeks, yearlyGoal? }
Restaurant  { id, name, priceLevel: 1-4, cuisines: string[], categoryIcon, neighborhood, city, lat, lng, hours, avgScore, ratingCount, reservable, orderable }
Ranking     { id, userId, restaurantId, score: 0-10, visits, notes, photos: string[], withUserIds: string[], createdAt }
Bookmark    { userId, restaurantId, createdAt }               // Want to Try
FeedItem    { id, actorId, type: 'ranked' | 'bookmarked', restaurantId, rankingId?, likes, comments, createdAt }
FeaturedList{ id, title, city, coverPhoto, restaurantIds[] }   // "You've been to X of 10"
Invite      { remaining, joinedCount, unlockThresholds }        // 0/5 unlocks features
```

**Ranking logic (Beli-style):** instead of typing a number, the user picks "liked it / fine / didn't like it", then does pairwise comparisons ("Which was better?") against places already in that bucket (binary insertion). Scores are then spread across 0–10 within each bucket based on position. Scores show a lock until the user has ranked enough places for them to be meaningful (see Magnolia/Glace in 06).

## Part 4 — Instructions for Claude Code

Paste this into Claude Code from the folder containing this file and the `screens/` folder:

```
Read beli-screens-spec.md and look at every image in screens/. Build a mobile app that recreates
these screens with original branding (pick a new name and wordmark; use placeholder food photos).

Stack: Expo + React Native + TypeScript, expo-router with a 5-tab bottom bar
(Feed, Your Lists, Search [center + button], Leaderboard, Profile). Use lucide-react-native icons.
Put the Part 2 design tokens in theme.ts and build shared components first:
Pill, ScoreBubble (color by score, optional count badge), RestaurantRow, FeedPost (photo strip,
notes with "See more", action row), StatCard, SegmentedTabs, PhotoCarouselCard.

Data: seed local mock data (lib/mock.ts) using the restaurants, scores and posts in the spec,
following the Part 3 data model. Keep state in Zustand so ranking/bookmarking updates every screen.

Screens, in this order:
1. Profile (02, 03, 04, 09, 10) incl. Activity / Taste Profile / Guides tabs and the calendar grid
2. Your Lists (05, 06, 07) with Been/Want to Try/Recs tabs, filter pills, sort toggle, View Map button,
   sticky "party • date • time" bar
3. Feed/Home (01, 12) incl. invite-unlock card and Featured Lists carousel
4. Search (08) with Restaurants/Members tabs and Recents
5. The "rank a restaurant" flow from the + button: pick bucket, pairwise comparisons, notes, photos

After each screen, run it in the iOS simulator, screenshot it, compare to the matching image in
screens/, and fix spacing/colors before moving on. Leaderboard can be a simple ranked user list.
```

Later steps once the UI works: swap mock data for a backend (Supabase: auth, Postgres tables from Part 3, storage for photos), Google Places for restaurant search, and a map view (react-native-maps).
