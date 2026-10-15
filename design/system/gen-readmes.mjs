// Writes project/components/<Name>/README.md (guidelines; first sentence = the summary).
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

const R = {
  Wordmark: `The bevi logo: lowercase letters in \`primary\` with the i's dot drawn as two \`fizz\` bubbles.

- Provide: \`height\` (28 in headers, the only in-app size), \`tone\` = \`brand\` (default), \`inverse\` (on \`tasteCard\` or a photo) or \`mono\` (inherits \`currentColor\`).
- It is outlined SVG, so it never depends on Fredoka loading. Never retype "bevi" in a font to stand in for it.
- Do: sit it at the header's left on the 16pt gutter (Feed, Add Bev). Don't: recolour the bubbles, add a tagline beside it in the header, or set it in Beli's teal or a serif.`,
  Icon: `Lucide outline icons, the 50 the app uses, including one per drink category.

- Provide: \`name\` (see \`Bevi.iconNames\`), \`size\` (28 for header and action rows, 24 in profile rows and stat cards, 16 inline in meta lines), \`strokeWidth\` (1.6–1.75 at 24–28, 2 at 16), \`filled\` for a saved bookmark.
- Colour comes from CSS \`color\`: \`text\` by default, \`primary\` for an active or saved state, \`textSecondary\` for chevrons and recents.
- Category icons: use \`Bevi.categories\` rather than picking icons by hand so every screen agrees.`,
  BevArt: `Placeholder drink cutouts for mockups, standing in for catalog photos until Arjun's background-removal pipeline delivers real ones.

- Provide: \`kind\` (can, slimCan, bottle, waterBottle, boba, icedCup, mug, wine, pint, carton), \`color\` (the product's body or liquid colour) and \`accent\` (label, band or straw).
- Pass it as \`art\` to BevImage or FeaturedCard instead of rendering it bare.
- Don't ship it in the app, and don't draw brand logos onto it: real Bevs always have a real photo (vision §2).`,
  BevImage: `The Bev's square tile: a transparent cutout centred with 8% padding on a soft tint of \`input\`, rounded by \`radius-photo\`.

- Provide: \`src\` (cutout URL) or \`art\` (BevArt props), \`alt\` (the Bev's name), \`size\`: 40, 56 (search rows), 96 (compare cards), 155 (feed photo strips, the gut check, Bev detail).
- \`status="processing"\` shows the raw photo under a shimmer while background removal runs; \`loading\` is the skeleton.
- Don't crop the product or put it on a photo background: the tile is the Bev's icon everywhere.`,
  ScoreBubble: `Beli's score mark: a \`surface\` circle with a 2pt \`border\` ring and the score in bold, coloured by its bucket band.

- Provide: \`score\` (0–10; shown to one decimal), \`size\` 40 (rows, posts) or 56 (Bev detail, ranking result).
- No count on the bubble: a badge read like a vote tally. A Bev's rating count is words in a meta line instead (BevRow's \`count\`, the Bev detail tile's "5k ratings").
- \`variant="predicted"\` = dotted ring and "~" prefix (Recommended, "You'd rate it"); \`locked\` = lock icon, no number (prediction confidence < 0.25, or fewer than 3 rankings).
- Bands: ≥ 7 \`scoreHigh\`, ≥ 4 \`scoreMid\`, else \`scoreLow\`. The number always shows, so colour is never the only signal.`,
  PriceTier: `The price tier as Beli prints it in a meta line: the active count of "$" only, with "~" when Bevi estimated it.

- Provide: \`tier\` 1–4, \`estimated\`.
- It inherits the line's size and colour; it reads "about $$, estimated" to screen readers.
- Write meta lines as \`$$ • Category\`, with a bullet and spaces.`,
  Avatar: `A circle with two initials in \`textSecondary\` on \`avatarFill\`, or the person's photo.

- Provide: \`name\` (initials come from the first two words), \`src\` optional, \`size\` 32 (tab bar), 44 (people rows), 60 (feed posts), 100 (profile hero, initials 40pt light).
- \`ring\` adds a \`surface\` outline for overlapping stacks.`,
  AvatarStack: `Overlapping avatars for "Friends who've had it" on Bev detail, with a "+N" chip past \`max\`.

- Provide: \`people\` ({ name, src? }), \`size\` (32), \`max\` (4).
- Pair it with a text line naming the first friends and their scores; the stack alone carries no scores.`,
  Pill: `The 30pt rounded pill: \`filled\` (\`primary\`) for actions, \`outlined\` for options and toggles.

- Provide: \`variant\`, children (the label, sentence case), optional \`icon\` (leading) or \`iconRight\` (a chevron for menus), \`active\` for a selected outlined pill (turns \`primaryTint\`).
- Uses: "Snap it", "Find people", Follow (filled) / Following (outlined), "Too close to call", Rank it and Want to Try on Bev detail.
- Its hit area extends to 44pt; keep 10–12pt between pills in a row.`,
  Button: `Rectangular buttons: \`outlined\` 36pt with \`radius-button\` for the profile row, \`primary\` 52pt for one main action per screen.

- Provide: \`variant\` (outlined, primary, ghost), \`size\` (md 36, lg 52), children, optional \`icon\`, \`block\` for full width, \`loading\` (spinner, disabled).
- At most one \`primary\` button per screen. Use Pills for the short actions inside content.`,
  IconButton: `A bare 28pt outline icon with a 44pt target, or the grey 32pt close circle.

- Provide: \`icon\`, \`label\` (required: it is the accessible name), \`variant\` (plain or filled), optional \`badge\` count.
- Header icons sit 20pt apart; the close circle is the Add Bev tab's and the ranking flow's dismiss.`,
  FilterPill: `Outlined pill that opens the filter sheet; it shows a \`primary\` count badge and turns \`primaryTint\` while filters are on.

- Provide: \`count\` (active filters), optional \`label\` with \`chevron\` for single-facet pills (Bucket, Price, Category), \`icon={null}\` to drop the filter glyph.
- Sits first in the list filter row, followed by the SortToggle line.`,
  SortToggle: `"↓↑ Score" in \`primary\` with a search icon at the right edge: the sort line above every list.

- Provide: \`label\` (Score, Recent, Name), \`onClick\` to cycle (required: a list with one order has no SortToggle), \`onSearch\` to show the search icon (omit it and there is no icon).`,
  SearchBar: `Search input in two forms: \`filled\` (grey 36pt bar at the top of Feed) and \`outlined\` (48pt field on the Add Bev tab).

- Provide: \`placeholder\` that names what can be found ("Search a Bev, brand or flavor", "Search by name or @handle"), \`value\`/\`onChange\`, \`id\`.
- A clear button appears once there is text. Debounce queries 250ms.`,
  TextField: `Labelled 48pt text field for onboarding, settings and the create-Bev wizard.

- Provide: \`label\`, \`value\` or \`defaultValue\`, optional \`prefix\` ("@" for handles), \`hint\`, \`error\` (replaces the hint, turns the outline \`scoreLow\`).
- Errors say what to do: "That handle is taken." not "Invalid input".`,
  PriceTierPicker: `Four tappable "$" cells plus "Not sure, estimate it", for step 2 of the create-Bev wizard.

- Provide: \`value\` 1–4 or null, \`estimated\`, \`onChange(tier, estimated)\`. Choosing "estimate" sends \`priceTier: null, priceEstimated: true\`.`,
  Header: `The 44pt screen header: the wordmark or a 20pt bold title on the left, 28pt icons on the right; list screens centre a caps title instead.

- Provide: \`wordmark\` or \`title\`, \`centered\` for list screens ("YOUR LISTS", "LEADERBOARD"), \`actions\` ([{ icon, label, onClick, variant? }]), \`onBack\` for pushed screens.
- No bell or calendar in v1.`,
  SectionHeader: `Caps section label ("FEATURED BEVS", "YOUR FEED") with an optional "See all" link in \`primary\`.

- Provide: \`title\` (written in sentence case; it renders uppercase), \`action\` and \`onAction\`.`,
  ListScopeDropdown: `Beli's "All ⌄": a 28pt bold label that opens a sheet to scope a list to one category.

- Provide: \`label\` ("All" or the category's label), \`onClick\` to open the Sheet.
- One per screen, above the tabs on Your Lists and below them on Leaderboard.`,
  SegmentedTabs: `Underline tabs with an animated 3pt bar.

- \`underline-text\` (Your Lists: Bev'd · Want to Try · Recommended; Leaderboard: Bevs · People): 20pt labels that scroll sideways, bar in \`text\`.
- \`underline-icon\` (Profile: Activity · Taste Profile; Add Bev: Bevs · People): equal halves, icon + 17pt label. \`accent="primary"\` on the Add Bev tabs, \`text\` on Profile.
- Provide: \`tabs\` ([{ id, label, icon? }]), \`value\`, \`onChange\`.`,
  TabBar: `The five-tab bar: Feed, Your Lists, Add Bev (a 32pt \`primary\` circle with a white plus, inline), Leaderboard, Profile (the user's 32pt Avatar).

- Provide: \`active\`, \`user\` (for the avatar), \`onChange\`, \`safeArea\` (adds the 34pt home-indicator inset).
- Icons are 28pt outlines; labels 10pt, the active one bold.`,
  BevRow: `The ~126pt list row from Beli: name (optionally numbered), \`$$ • Category\`, category icon • brand, a meta line, Rank and Want to Try actions, and a ScoreBubble.

- Provide: \`bev\`, \`number\` (Bev'd and Leaderboard), \`score\` (\`scoreVariant="predicted"\` on Recommended), \`meta\` ("Ranked Oct 3", "Saved from @arjun", a recommendation reason), \`count\`, \`saved\`, \`onRank\`, \`onSave\`.
- The meta line is \`meta\` when the row has one. Only a row with no meta of its own (search results) prints the rating count there instead: "1 rating", "362 ratings", "5k ratings", even under a locked bubble, and nothing at 0. Leaderboard, Want to Try and Recommended rows keep just their own meta.
- No image by default, as in the reference; \`showImage\` adds a 56pt BevImage for search results and "Did you mean…".
- One list sorted by score: buckets show through the bubble colour, not as sections.`,
  FeedPost: `A ranking or save in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**", meta line, ScoreBubble, a 155pt photo strip, notes and actions.

- Provide: \`actor\` (or \`you\` for "You"), \`verb\` (ranked or saved), \`bev\`, \`score\`, \`note\`, \`time\` ("5 hours ago", "Wednesday"), \`saved\`, \`onRank\`, \`onSave\`.
- Notes over 160 characters truncate with "See more". A \`saved\` post has no score and no photo.
- No likes, comments or share in v1. Alcoholic Bevs from friends render without the Rank action for under-21 viewers.`,
  FeaturedCard: `164pt square photo card for the Featured carousel: image, a \`photoScrim\` gradient, white 20pt title and 15pt subtitle.

- Provide: \`title\`, \`subtitle\` (category + "$" for a Bev, "You've had 3 of 10" for a list), \`src\` or \`art\` with a \`tint\` backdrop.
- Carousel gap 16pt under a SectionHeader with "See all".`,
  ProfileListRow: `The profile's 44pt link rows: Bev'd, Want to Try, Recommended for you.

- Provide: \`icon\` (circle-check, bookmark with \`iconFilled\`, heart), \`label\`, \`count\` (omit on Recommended), \`onClick\` (deep-links to the Your Lists tab).
- Recommended is always shown, even at zero ranked.`,
  StatCard: `Profile stat card (181×84, \`radius-stat\`): a \`primary\` icon, a label over a \`primary\` value.

- Provide: \`icon\` (trophy, flame), \`label\` ("Rank on Bevi", "Current Streak"), \`value\` ("#12", "4 days"). Two per row, 10pt apart.
- New users: "Unranked" and "Rank today to start".`,
  UserRow: `A person row for People search, followers lists and the user leaderboard.

- Provide: \`user\` ({ name, handle }), \`meta\` ("84 Bevs", "212 pts"), optional \`rank\` and \`streak\`, \`following\` to show the Follow/Following pill, \`self\` to highlight your own row in \`primaryTint\`.
- Pin your own row at the bottom of the leaderboard when it's off screen.`,
  BucketButton: `Gut-check choice in the ranking flow: a capsule with a glossy orb in its bucket colour that fills with that colour when chosen, in liquid glass where the OS has it and a flat tint everywhere else.

- Provide: \`bucket\` (loved, fine, disliked), \`selected\`, \`material\`, \`onClick\`. Always show all three, in that order, 14pt apart, full width on the 16pt gutter.
- Labels and faces are fixed: "Loved it" (laugh), "It was fine" (meh), "Didn't like it" (frown). The label always shows, so a bucket is never told apart by colour alone; the chosen one also gets a ring and a filled check.
- \`material="glass"\` (default): \`glassFill\` blurred 24px over a BevGlow, a \`glassStroke\` rim, a top sheen and \`elevation-glass\`. Render it only where the OS has a real glass material: iOS 26+, with the native \`GlassView\` from expo-glass-effect. Never imitate it with a blur view.
- \`material="tint"\`: the fallback for Android and iOS before 26. Same 64pt height, \`radius-card\` corners, a 12% bucket tint and a 4px bucket bar on the left; no blur, no shadow. The orb, label, check and pour are identical, so the flow feels the same on every phone. Reduce Transparency switches glass to tint on every platform.
- Choosing one pours: the liquid (the bucket colour mixed 45% into \`surface\`, 70% opaque) rises to two-thirds in 450ms under a moving surface with a light meniscus and a few rising bubbles. The meniscus stays above the label, never across it. Reduce Motion keeps the level and stops the waves and bubbles. Draw the waves with react-native-svg and drive the pour with Reanimated.
- Contrast, worst case (glass over any BevGlow, checked against black, white and saturated drink colours with every blob overlapping): \`text\` stays at least 9.8:1 in light and 5.7:1 in dark, poured or not. On the tint material it stays at least 7.3:1.
- Don't add a fourth option, use the glass for other buttons, or tint the label text with the bucket colour.`,
  BevGlow: `Soft colour field for the gut check: the Bev's own colour, \`primary\` and \`fizz\`, blurred into the \`surface\` behind liquid-glass controls.

- Provide: \`color\` (the drink's main colour, the same one its photo is mostly made of), children. It fills its container; size the container.
- Use it only where glass sits (the gut-check step). Everywhere else Bevi is flat \`surface\` with hairlines.
- On the gut check, the Bev's cutout floats on the glow at 200pt with no BevImage tile.`,
  CompareCard: `One side of "Which was better?": BevImage 96, the name at 20pt bold, the brand, and where the incumbent sits now.

- Provide: \`bev\`, \`isNew\` for the Bev being ranked (top card) or \`rankLabel\` ("#3 in Loved") for the incumbent (bottom card), \`selected\`, \`onClick\`.
- Below the pair: an outlined "Too close to call" Pill and an Undo text button. The card swap animates 250ms (cross-fade under reduced motion).`,
  ProgressDots: `Comparison progress for the ranking flow: one dot per possible comparison (\`maxComparisons(n)\`), the current one stretched.

- Provide: \`total\`, \`current\` (0-based). It can finish early: binary search often needs fewer steps.`,
  EmptyState: `Centred icon, title, one line of help and one action, for a list with nothing in it.

- Provide: \`icon\`, \`title\` that says what will appear ("Follow friends to see their Bevs"), \`body\`, \`action\` + \`onAction\` that fixes it ("Find people", "Add your first Bev").`,
  ErrorState: `Failure message with Retry, driven by \`BeviApi\` error codes.

- Provide: \`title\` and \`message\` that say what happened and what to do, \`icon\` (wifi-off for \`network\`), \`onRetry\`.
- No apologies, no codes in the copy.`,
  Skeleton: `Loading placeholder in the shape of the final layout; every list loads with this, never a bare spinner.

- Provide: \`variant\` (row, post, text, block, circle), and sizes for the plain shapes. The shimmer stops under reduced motion.`,
  Sheet: `Bottom sheet with a handle, over a \`scrim\`; snaps to 40% or 90% of the screen.

- Provide: \`title\`, \`snap\`, \`onClose\`, children (option rows 48pt with 1pt dividers, a check in \`primary\` on the chosen one).
- Uses: list scope, filters, re-rank, category picker, report a Bev, settings.
- It fills its nearest positioned ancestor: render it inside the screen container.`,
};

const S = {
  ScreenFeed: `Feed tab (ref 01, 12): Header with the wordmark and Find people, the filled SearchBar, "FEATURED BEVS" FeaturedCards, then "YOUR FEED" FeedPosts, over the TabBar.

- Following nobody: an EmptyState under YOUR FEED ("Follow friends to see their Bevs" + Find people); Featured stays.
- Dropped from Beli: quick-action pills, the composer, the invite card, likes and comments.`,
  ScreenYourLists: `Your Lists › Bev'd (ref 06): centred "YOUR LISTS" Header, ListScopeDropdown, SegmentedTabs, the FilterPill row, SortToggle, then numbered BevRows sorted by score.

- Want to Try rows show the global score and a filled bookmark, with when or from whom you saved it in the meta line; Recommended rows show predicted bubbles and a reason in the meta line.`,
  ScreenAddBev: `Add Bev tab (ref 08): wordmark Header with the close circle, Bevs · People tabs in \`primary\`, the outlined SearchBar, a "Snap it" Pill, Recents, and a sticky "Can't find it? Add a new Bev".

- Results are BevRows with \`showImage\` and the rating count as their meta line ("362 ratings"); tapping a Bev you haven't ranked goes straight into the ranking flow.`,
  ScreenGutCheck: `Ranking flow, step 1 (no reference): a BevGlow in the drink's colour fills the screen; the cutout floats at 200pt over its name, brand and category; "How was it?"; three liquid-glass BucketButtons; a hint that comparisons come next.

- Choosing a bucket pours it, then moves on to comparisons. An empty bucket skips straight to the note: "First one in Loved".`,
  ScreenRanking: `Ranking flow, step 2 (no reference): ProgressDots and the close circle, "Which was better?", two CompareCards (new on top), "Too close to call" and Undo.

- After placement: an optional 140-character note, then the result: ScoreBubble 56 and "#4 of 31 in Loved · 8.9".`,
  ScreenBevDetail: `Bev detail (no reference): BevImage 155, name, brand, category and PriceTier; two stat cards (Bevi score with "5k ratings" under it, "You'd rate it" predicted); friends who've had it; Rank it and Want to Try Pills.

- Not enough rankings: the second bubble is \`locked\` with "Rank 3 Bevs to see your prediction".`,
  ScreenProfile: `Profile tab (ref 02, 03): name Header, Avatar 100, handle, counts, the outlined Button row, three ProfileListRows, two StatCards, Activity · Taste Profile tabs, then your FeedPosts.`,
  ScreenLeaderboard: `Leaderboard tab (no reference): centred "LEADERBOARD", Bevs · People tabs, the category scope, then numbered BevRows with the Bayesian score; "Your score 7.6" (or "Not ranked yet") in the meta line, with no rating count.

- People tab: UserRows with rank, points, Bevs and streak; your own row pinned and highlighted.`,
};

for (const [name, body] of Object.entries({ ...R, ...S })) {
  const dir = path.join(ROOT, 'project/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\n${body}\n`);
}
console.log('readmes', Object.keys(R).length + Object.keys(S).length);
