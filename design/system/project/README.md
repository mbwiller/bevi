Bevi is Beli for drinks: you rank every beverage you've had by answering "Which was better?", and Bevi turns your answers into a 0–10 score, a personal list, a global leaderboard and a guess at how much you'd like a drink you haven't tried. The interface follows Beli's layout closely (white screens, 1pt hairlines, coloured score bubbles, one brand colour for every action) and swaps in Bevi's own identity: a grape `primary`, a rounded wordmark with fizz bubbles, and drink cutouts where Beli has food photos.

Build iOS-first at 393×852pt. Every size below is in pt.

## Voice and copy

- **The nouns are ours.** A drink is a **Bev** ("Add a new Bev", "Top 10 Sparkling Waters"). Ranking one is to **Bev** it: "**Arjun** Bev'd **Horchata**", the Bev'd list. Saved drinks are **Want to Try**. The algorithm's list is **Recommended for you**.
- **Ranking language is fixed.** Gut check: "Loved it", "It was fine", "Didn't like it". Comparison: "Which was better?", "Too close to call", "Undo". Prediction: "You'd rate it" with a `~8.2` bubble; on a list row the reason sits in the meta line ("You love diet sodas", "People who rank like you", "Something different").
- **Sentence case** for buttons, tabs and titles ("Edit profile", "Want to Try" keeps its capitals because it is a list's name). Section labels are set in caps by `sectionCaps`, not typed in caps.
- **Second person, plain and short.** Empty states say what will appear and how to make it happen: "Follow friends to see their Bevs" + Find people. Errors say what happened and what to do, without apologies: "You're offline. We'll show your list again as soon as you're back online."
- **Numbers:** scores always one decimal (`9.3`, never `9.30` or `93`); rank as `#12`; counts as Beli prints them (`362`, `5k`); price as `$`–`$$$$`, with `~` when Bevi estimated it, on Bev detail only (never on rows or posts); dates as "Ranked Oct 3", times as "5 hours ago" or a weekday.
- **No emoji** in the interface. Users' notes keep their own voice and casing ("tastes like flat Sprite, in a good way").
- The product is **Bevi** in sentences; the logo is lowercase **bevi**. Never write "BEVI" or "Bev-i".

## Colour

Use the tokens by name; never paste hex values.

- `surface` is the page and every card. Cards are separated with a 1pt `border`, never a shadow or a grey fill. Grey fills (`input`) are for the search bar, BevImage tiles and skeletons only.
- `text` for content, `textSecondary` for meta lines, labels, timestamps and placeholders. Both clear 4.5:1 on `surface`, `input` and `avatarFill` in both themes.
- `primary` (Bevi grape) goes exactly where Beli uses its teal: filled Pills, the primary Button, the Add tab circle, a saved bookmark, a liked heart, the FilterPill count, StatCard values and icons, SortToggle and "See all". Nothing else is grape, so a grape thing is always something to tap or a value you earned. Text on a `primary` fill is `onPrimary` (white in light, dark ink in dark mode).
- `primaryTint` behind `primary` text marks a selected chip or an active filter.
- **Score colours follow the bucket bands**: `scoreHigh` 7–10 (Loved), `scoreMid` 4–7 (Fine), `scoreLow` 0–4 (Didn't like). Use them for score numbers, bucket bars and 12% bucket tints, never for decoration. They share a lightness, so a score always shows its number and a bucket always shows its label.
- `fizz` is the wordmark's bubbles and one blob of the BevGlow; it never carries text or meaning.
- `tasteCard`, `photoScrim` and `onDeep` (white) are the fixed-dark set: the Taste Profile card, photo overlays and the text on them.
- `glassFill`, `glassStroke` and `glassHighlight` make the liquid-glass material. The gut-check BucketButtons use their tint material by default, and always on the Bevi web app. Glass is only for a native build on iOS 26+ (the native `GlassView`), only over a BevGlow; it is never imitated with a blur.
- `borderStrong` outlines controls (outlined Pills and Buttons, text fields, the outlined search bar) so they meet 3:1; `border` is for hairlines.
- Beli's measured grey and score colours failed the plan's 4.5:1 rule, so the tokens are darker versions of the same hues. Each token's note records Beli's value.

## Type

- **System font only** in the app (`--font-sans`: SF Pro on iOS, Roboto on Android). The scale, measured from the reference: `displayDrop` 28 bold (the "All ⌄" scope), `screenTitle` 20 bold (header titles, row names, post sentences, stat values), `tabLabel` 20 semibold, `heading` 17 semibold (score numbers, counts, the sort toggle), `bodyLarge` 17 (notes, search text), `body` 15 (meta lines, buttons), `sectionCaps` 15 bold, tracked 0.5, always uppercase, `caption` 13, `tabBar` 10 (bold when active).
- In a feed sentence the names are bold and the verb is regular: "**Arjun** Bev'd **Horchata**".
- Use `font-variant-numeric: tabular-nums` wherever scores, counts or ranks line up.
- Fredoka (`--font-display`) is the wordmark's face. The app never loads it; it appears only in brand art.
- Cap Dynamic Type at 1.3× on dense rows; body text scales freely.

## Layout and shape

- 16pt screen gutter (`space-gutter`) on every screen. 44pt header row under the status bar. 4pt grid: `space-xs` 4 … `space-xxl` 24.
- Every tap target is at least 44×44 (`size-target`), even when the visual is a 30pt Pill or a 28pt icon.
- Radii are named by what they round: `radius-button` 8 (outlined profile buttons), `radius-input` 12 (search, fields, the big primary button), `radius-photo` 14 (Bev tiles, featured photos), `radius-card` 16 (cards, sheet tops), `radius-stat` 20 (profile stat cards), `radius-pill` 999.
- **No elevation.** Separation is a 1pt `border`. Every focusable control shows `focus-ring` (a 2pt `surface` gap, then a 2pt `primary` ring). The gut-check BucketButtons use a 12% bucket tint and a 4px bucket bar, with no blur and no shadow; that is all the web app ever draws. The one exception is reserved for a native build: on iOS 26+ they may be liquid glass (`GlassView`) on `elevation-glass` over a BevGlow. Nothing else gets glass, blur or a shadow.
- Rows are full-bleed with 1pt dividers. Lists are one sorted list: buckets show through bubble colour, not section headers.

## Imagery

- **Every Bev has a photo, and it is a cutout**: PNG with alpha, the product filling 70–90% of the longest side, no baked-in shadow, no text overlays, at least 600px. User photos get the same look after background removal; while that runs, BevImage shows `status="processing"`.
- The cutout sits in a BevImage tile (a soft `input` tint, `radius-photo`), never on a busy photo. The one exception is the gut check, where it floats at 200pt on a BevGlow of its own colour. FeaturedCards may use polished full-bleed images under `photoScrim`.
- Until catalog photos exist, mock screens with `BevArt` (can, slimCan, bottle, waterBottle, boba, icedCup, mug, wine, pint, carton) in the product's colours. Never draw brand logos.

## Iconography

- Lucide outline icons (ISC), bundled as the `Icon` component; the same names exist in lucide-react-native for the app. 28pt with stroke 1.6 in headers and action rows, 24pt in profile rows and stat cards, 16pt with stroke 2 inside meta lines.
- Icons take `text`; `primary` when active, saved or liked (a saved bookmark and a liked heart are `filled`); `textSecondary` for chevrons and recents.
- Actions: `circle-plus` = Rank it, `bookmark` = Want to Try, `circle-check` = Bev'd, `heart` = Recommended (in a post's action row, `heart` = Like: filled grape once you've liked it), `message-circle` = Comment (right after the heart; it never turns grape), `trophy` = rank, `flame` = streak, `lock` = hidden score.
- One icon per category, always from `Bevi.categories`: soda `cup-soda`, diet soda `candy-off`, juice `citrus`, water `glass-water`, sparkling water `droplets`, energy `zap`, coffee `coffee`, tea `leaf`, boba `milk`, sports `dumbbell`, smoothie `banana`, beer `beer`, wine `wine`, spirits & cocktails `martini`, other `globe`. The three alcoholic categories are hidden from under-21 users everywhere.

## Motion

- `fast` 150ms for presses, colour changes and the like pop, `base` 250ms for tab underlines, sheets and the compare-card swap, `springy` (Reanimated spring, damping 18, stiffness 180) for the result bubble, `pour` 450ms for the score reveal on the note step (the ScoreBubble 72 pours in and counts up from its bucket's lower edge to the score; under reduced motion the number shows at once).
- The pour: choosing a bucket fills its button in 450ms with a slight overshoot; the surface drifts in a 5s loop and a few bubbles rise. It is the one ambient animation in the app.
- The like burst: a double-tap on a post grows a filled `primary` heart over its photo, holds it and fades it within 800ms.
- Animate transform and opacity (and the pour's height) only. Under reduced motion, swaps become cross-fades, shimmers stop, the like burst only fades, and the pour lands without waves or bubbles. Under reduced transparency, glass becomes the tint material.

## Building screens

- Wrap content the way the screens in this system do: `Header`, then content on `surface`, then `TabBar` at the bottom. Load `tokens.css` and `components/bundle.css` before using `window.Bevi`.
- Feed: wordmark Header, filled SearchBar, SectionHeader + FeaturedCards, SectionHeader + FeedPosts. Each post's action row starts with the heart and the comment bubble; up to seven comments show under it, more collapse to "View all N comments", and both open the CommentsSheet.
- Lists (Your Lists, Leaderboard): centred caps Header, ListScopeDropdown, SegmentedTabs, FilterPill row, SortToggle, numbered BevRows.
- Ranking: a BevGlow with the floating cutout and three BucketButtons, then ProgressDots and CompareCard pairs, then the note step with the score revealed at once in a ScoreBubble 72 over "#4 of 31 in Loved", then a ScoreBubble 56 result that confirms it.
- Profile: name Header, Avatar 100, counts, outlined Buttons, ProfileListRows, two StatCards, Activity tabs, FeedPosts.
- The Screens group shows each of these composed at 393pt.

## In the app

The tokens map one to one onto `app/src/theme/tokens.ts`: colour names are the same (`colors.primary`, `colors.textSecondary`), spacing drops the prefix (`space-md` → `spacing.md`), radii too (`radius-card` → `radius.card`), and type styles become `type.screenTitle` and so on. Components keep their names in `app/src/components/`.

## Intentional additions

The plan's component list (DEVELOPMENT-MATT §4) covers the screens that have a Beli reference. These were added for the screens that don't, or to keep the rest consistent:

- `BucketButton`, `CompareCard`, `ProgressDots`: the ranking flow (§6.9). BucketButton is a tinted capsule with an orb and a pour rather than §6.9's tinted bar (glass only on a native iOS 26+ build).
- `BevGlow`: the colour field behind the BucketButtons on the gut check.
- `UserRow`, `AvatarStack`: People search, followers, the user leaderboard and "Friends who've had it" (§6.8, §6.11, §6.12).
- `TextField`, `PriceTierPicker`: onboarding and the create-Bev wizard (§6.2, §6.10).
- `Header`, `SectionHeader`, `IconButton`, `Button`: the header pattern, caps section labels, the close circle and the 36pt profile buttons, all described in §4 and §6 but not named as components.
- `Icon`, `BevArt`: the icon set as one source, and placeholder drink art until catalog photos exist.
