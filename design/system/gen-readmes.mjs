// Writes project/components/<Name>/README.md (guidelines; first sentence = the summary).
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

const R = {
  Wordmark: `The bevi logo: lowercase letters in \`primary\` with the i's dot drawn as two \`fizz\` bubbles.

- Provide: \`height\` (28 in headers, the only in-app size), \`tone\` = \`brand\` (default), \`inverse\` (on \`tasteCard\` or a photo) or \`mono\` (inherits \`currentColor\`).
- It is outlined SVG, so it never depends on Fredoka loading. Never retype "bevi" in a font to stand in for it.
- Do: sit it at the header's left on the 16pt gutter (Feed, Search). Don't: recolour the bubbles, add a tagline beside it in the header, or set it in Beli's teal or a serif.`,
  Icon: `Lucide outline icons, the 55 the app uses, including one per drink category.

- Provide: \`name\` (see \`Bevi.iconNames\`), \`size\` (28 for header and action rows, 24 in profile rows and stat cards, 16 inline in meta lines), \`strokeWidth\` (1.6–1.75 at 24–28, 2 at 16), \`filled\` for a saved bookmark or a liked heart.
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

- Provide: \`score\` (0–10; shown to one decimal), \`size\` 40 (rows, posts), 56 (Bev detail, ranking result) or 72 (the ranking note step, where the score is revealed the moment placement finishes).
- No count on the bubble: a badge read like a vote tally. A Bev's rating count is words in a meta line instead (BevRow's \`count\`, the Bev detail tile's "5k ratings").
- \`variant="predicted"\` = dotted ring and "~" prefix (Recommended, "You'd rate it"); \`locked\` = lock icon, no number (prediction confidence < 0.25, or fewer than 3 rankings).
- Bands: ≥ 7 \`scoreHigh\`, ≥ 4 \`scoreMid\`, else \`scoreLow\`. The number always shows, so colour is never the only signal.`,
  PriceTier: `The price tier as Beli prints it in a meta line: the active count of "$" only, with "~" when Bevi estimated it.

- Provide: \`tier\` 1–4, \`estimated\`.
- It inherits the line's size and colour; it reads "about $$, estimated" to screen readers.
- **Never on rows or posts**, estimated or not (D-06): a price on every row was too much information. It shows on Bev detail, the gut-check card and featured cards. The create-Bev wizard picks a tier with \`PriceTierPicker\`.`,
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
- Header icons sit 20pt apart; the close circle is the Search tab's and the ranking flow's dismiss.`,
  LikeButton: `The post's like control, Instagram's heart: a 28pt \`heart\`, outline in \`text\` until liked, then filled \`primary\`, with the like count beside it.

- Provide: \`liked\`, \`count\` (printed like other counts: "12", "5k"; hidden at 0), \`onClick\` to toggle.
- Accessible name "Like" or "Unlike", plus the count when there is one ("Unlike, 12 likes"), and \`aria-pressed\`. The target is at least 44pt; the count sits inside it.
- A press pops the heart to 1.2× and back in \`fast\` (150ms), transform only; Reduce Motion drops the pop.
- The count stays \`text\`: only the heart turns grape, like the saved bookmark.
- It lives in FeedPost's action row. Liking by double-tap and its burst belong to FeedPost.`,
  CommentButton: `The post's comment control, Instagram's speech bubble, right after the heart: a 28pt \`message-circle\` outline in \`text\` with the comment count beside it.

- Provide: \`count\` (all comments on the post, printed like other counts: "3", "5k"; hidden at 0), \`onClick\` to open the comments sheet.
- Accessible name "Comment", plus the count when there is one ("Comment, 3 comments"). The target is at least 44pt; the count sits inside it.
- It has no on state and never turns grape: commenting is not a value you earned, and the heart stays the only grape icon in the row.
- No likes on comments.`,
  FilterPill: `Outlined pill that opens the filter sheet; it shows a \`primary\` count badge and turns \`primaryTint\` while filters are on.

- Provide: \`count\` (active filters), optional \`label\` with \`chevron\` for single-facet pills (Bucket, Price, Category), \`icon={null}\` to drop the filter glyph.
- Sits first in the list filter row, followed by the SortToggle line.`,
  SortToggle: `"↓↑ Score" in \`primary\` with a search icon at the right edge: the sort line above every list.

- Provide: \`label\` (Score, Recent, Name), \`onClick\` to cycle (required: a list with one order has no SortToggle), \`onSearch\` to show the search icon (omit it and there is no icon).`,
  SearchBar: `Search input in two forms: \`filled\` (grey 36pt bar at the top of Feed) and \`outlined\` (48pt field on the Search tab).

- Provide: \`placeholder\` that names what can be found ("Search a Bev or a person", "Search by name or @handle"), \`value\`/\`onChange\`, \`id\`, and \`onFocus\` where focusing opens something (the Search tab's results panel).
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

- Provide: \`title\` (written in sentence case; it renders uppercase), \`action\` and \`onAction\`.
- The link's spoken name is the action, then the title ("See all featured bevs"). When the two don't read well together, pass \`actionLabel\` (the People board's "How points work").`,
  ListScopeDropdown: `Beli's "All ⌄": a 28pt bold label that opens a sheet to scope a list to one category.

- Provide: \`label\` ("All" or the category's label), \`onClick\` to open the Sheet.
- One per screen, above the tabs on Your Lists and below them on Leaderboard.`,
  SegmentedTabs: `Underline tabs with an animated 3pt bar.

- \`underline-text\` (Your Lists: Bev'd · Want to Try · Recommended; Leaderboard: Bevs · People): 20pt labels that scroll sideways, bar in \`text\`.
- \`underline-icon\` (Profile: Activity · Taste Profile): equal halves, icon + 17pt label, with \`accent="text"\`; \`accent="primary"\` stays available for a grape bar.
- Provide: \`tabs\` ([{ id, label, icon? }]), \`value\`, \`onChange\`.`,
  TabBar: `The five-tab bar: Feed, Your Lists, Search (a 32pt \`primary\` circle with a white plus, inline, labelled as Beli labels it), Leaderboard, Profile (the user's 32pt Avatar).

- Provide: \`active\`, \`user\` (for the avatar), \`onChange\`, \`safeArea\` (adds the 34pt home-indicator inset).
- Icons are 28pt outlines; labels 10pt, the active one bold.`,
  BevRow: `The ~126pt list row from Beli: name (optionally numbered), one secondary line (category icon, then "Category · Brand"), a meta line, Rank and Want to Try actions, and a ScoreBubble.

- Provide: \`bev\`, \`number\` (Bev'd and Leaderboard), \`score\` (\`scoreVariant="predicted"\` on Recommended), \`meta\` ("Ranked Oct 3", "Saved from @arjun", a recommendation reason), \`count\`, \`saved\`, \`onRank\`, \`onSave\`.
- The meta line is \`meta\` when the row has one. Only a row with no meta of its own (search results) prints the rating count there instead: "1 rating", "362 ratings", "5k ratings", even under a locked bubble, and nothing at 0. Leaderboard, Want to Try and Recommended rows keep just their own meta.
- No image by default, as in the reference; \`showImage\` adds a 56pt BevImage for search results, "Did you mean…" and the Leaderboard's Bevs board.
- **One secondary line, no price.** "Soda · Coca-Cola" after the category icon; just the category when there's no brand. The flavour joins the brand ("LaCroix · Pamplemousse") unless it is "Original". The price tier stays off rows (D-06).
- One list sorted by score: buckets show through the bubble colour, not as sections.`,
  FeedPost: `A ranking in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**", meta line, ScoreBubble, a 155pt photo strip, notes and actions.

- Provide: \`actor\` (or \`you\` for "You"), \`bev\`, \`score\`, \`note\`, \`time\` ("5 hours ago", "Wednesday"), \`saved\`, \`liked\`, \`likeCount\`, \`comments\`, \`commentCount\`, \`onLike\`, \`onComment\`, \`onRank\`, \`onSave\`, \`onOpen\`.
- A post is always a ranking. Saving a Bev is not a post; the filled bookmark shows you already have it saved.
- The meta line under the name is the category icon and the brand (the category's name when there's no brand). No price on a post (D-06).
- Action row: the time on the left; on the right the LikeButton and the CommentButton, then Rank it and Want to Try. Heart and comment lead the group because they are about the post, while Rank and Want to Try are about the Bev.
- **Double-tap anywhere on the post outside the photo strip to like it**, Instagram-style. It only ever likes, never unlikes (the heart does that), and it is never the only way to like. A single tap on the photo still opens the Bev, so the strip ignores double-taps. The post sets \`touch-action: manipulation\` so Safari doesn't zoom on a double-tap.
- The burst: a 88pt filled \`primary\` heart grows over the photo strip (the post's centre when there is no photo), holds and fades within 800ms, transform and opacity only. Reduce Motion: a plain fade. It plays on every like by double-tap, even when the post was already liked.
- **Comments sit under the action row**, as on Instagram: the post (head, photos, note) reads first, the row of actions closes it, and the conversation follows. With 7 or fewer comments the post shows every one inline, oldest first, as "**handle** text" in \`body\` (\`comments\` is the contract's first seven). Above 7 it collapses to a single "View all N comments" line in \`textSecondary\`, with no preview, so a busy post stays one line taller, not seven. That line and the CommentButton both open the CommentsSheet.
- Notes over 160 characters truncate with "See more". Alcoholic Bevs from friends render without the Rank action for under-21 viewers.`,
  FeaturedCard: `164pt square photo card for the Featured carousel: image, a \`photoScrim\` gradient, white 20pt title and 15pt subtitle.

- Provide: \`title\`, \`subtitle\` (category + "$" for a Bev, "You've had 3 of 10" for a list), \`src\` or \`art\` with a \`tint\` backdrop.
- Carousel gap 16pt under a SectionHeader with "See all".
- Not on the Feed since M-05: Bev of the day and Bev of the week (BevOfCard) took its slot under the search bar.`,
  BevOfCard: `Bev of the day or Bev of the week, a pair side by side under the Feed's search bar: a caps label, the Bev's 164pt tile, its name and the score it won with. Just the Bev, never a post.

- Provide: \`period\` ("day" or "week"), \`bev\`, \`score\` (the Bayesian score it won with, set even when the Bev has a single rating), \`date\`, \`onClick\` (opens the Bev).
- The winner is the best Bayesian score among Bevs ranked that New York day or ISO week. When nobody ranked anything in the current period it is the latest period's winner, and \`date\` says which: "Oct 17", "Week of Oct 12". The current period shows no date.
- Lay the pair out with a 16pt gap in the gutter. No winner for either period: leave the row out. Only one: it sits on the left at its normal width.
- The whole card is one button: "Bev of the day: Horchata, 8.9" (with the date when there is one). The name wraps to two lines.`,
  ProfileListRow: `The profile's 44pt link rows: Bev'd, Want to Try, Recommended for you.

- Provide: \`icon\` (circle-check, bookmark with \`iconFilled\`, heart), \`label\`, \`count\` (omit on Recommended), \`onClick\` (deep-links to the Your Lists tab).
- Recommended is always shown, even at zero ranked.`,
  StatCard: `Profile stat card (181×84, \`radius-stat\`): a \`primary\` icon, a label over a \`primary\` value.

- Provide: \`icon\` (trophy, flame), \`label\` ("Rank on Bevi", "Current Streak"), \`value\` ("#12", "4 days"). Two per row, 10pt apart.
- New users: "Unranked" and "Rank today to start".`,
  ProgressStrip: `Bev'd's progress line under the filter row: "Soda · 4 of 61 tried · 6%" over a 4pt bar, a chevron, and a tap that opens the CollectionSheet.

- Provide: \`label\` (the scoped category, or "All Bevs"), \`ranked\` and \`total\` from \`stats.getCategoryProgress()\` (all categories summed for "All Bevs"), \`onClick\`.
- The percentage rounds **down** and never reads a misleading 0%: "<1%" once anything is tried, "0%" when nothing is. An empty category drops the percentage.
- The bar is \`input\` with a \`primary\` fill, because it is a share you earned (the README's rule for grape). It is decorative; the line and the spoken label carry the number ("Soda, 4 of 61 tried, 6 percent. Show your collection").
- While the numbers load, a one-line Skeleton holds the strip's place; if they fail, the strip is left out rather than showing a wrong count.`,
  ProgressBar: `A 4pt progress track in \`input\` with a \`primary\` fill: a share you earned. Used by the ProgressStrip and the CollectionSheet.

- Provide: \`value\` 0–1 (clamped).
- Decorative and hidden from screen readers: the text beside it always says the number.`,
  CollectionSheet: `"Your collection": a 90% Sheet with every category the viewer can see, in catalog order, each with its icon, "9 of 40" and the same 4pt bar.

- Provide: \`rows\` (\`{ categoryId, ranked, total }\`: the contract's \`CategoryProgress\`, from \`stats.getCategoryProgress()\`), \`onSelect\` (called with the \`categoryId\`), \`onClose\`. Categories with nothing in them are left out; the alcoholic three never reach an under-21 viewer.
- The sheet opens on the overall line ("37 of 378 tried · 9%"). Catalog order stays put as you rank, so a bar never jumps rows.
- Tapping a row scopes Bev'd to that category and closes the sheet.`,
  UserRow: `A person row for People search, followers lists and the user leaderboard.

- Provide: \`user\` ({ name, handle }), \`meta\` ("84 Bevs", "212 pts"), optional \`rank\` and \`streak\`, \`following\` to show the Follow/Following pill, \`self\` to highlight your own row in \`primaryTint\`.
- Pin your own row at the bottom of the leaderboard when it's off screen.`,
  BucketButton: `Gut-check choice in the ranking flow: a capsule with a glossy orb in its bucket colour that fills with that colour when chosen. It is a flat tint by default, and always on the Bevi web app; liquid glass only with the native glass material on iOS 26+.

- Provide: \`bucket\` (loved, fine, disliked), \`selected\`, \`material\`, \`onClick\`. Always show all three, in that order, 14pt apart, full width on the 16pt gutter.
- Labels and faces are fixed: "Loved it" (laugh), "It was fine" (meh), "Didn't like it" (frown). The label always shows, so a bucket is never told apart by colour alone; the chosen one also gets a ring and a filled check.
- \`material="tint"\` (default): 64pt high, \`radius-card\` corners, a 12% bucket tint and a 4px bucket bar on the left; no blur, no shadow. The Bevi web app always uses it, in every browser, including the home-screen app on iOS 26.
- \`material="glass"\`: \`glassFill\` with a 24px blur over a BevGlow, a \`glassStroke\` rim, a top sheen and \`elevation-glass\`. Render it only where the OS has a real glass material: iOS 26+, with the native \`GlassView\` from expo-glass-effect, which only a native build has. Never imitate it with a blur view or CSS \`backdrop-filter\`. The orb, label, check and pour are identical in both materials. Reduce Transparency switches glass to tint on every platform.
- Choosing one pours: the liquid (the bucket colour mixed 45% into \`surface\`, 70% opaque) rises to two-thirds in 450ms under a moving surface with a light meniscus and a few rising bubbles. The meniscus stays above the label, never across it. Reduce Motion keeps the level and stops the waves and bubbles. Draw the waves with react-native-svg and drive the pour with Reanimated.
- Contrast, worst case (glass over any BevGlow, checked against black, white and saturated drink colours with every blob overlapping): \`text\` stays at least 9.8:1 in light and 5.7:1 in dark, poured or not. On the tint material it stays at least 7.3:1.
- Don't add a fourth option, use glass for other buttons, or tint the label text with the bucket colour.`,
  BevGlow: `Soft colour field for the gut check: the Bev's own colour, \`primary\` and \`fizz\`, blurred into the \`surface\` behind the gut-check BucketButtons.

- Provide: \`color\` (the drink's main colour, the same one its photo is mostly made of), children. It fills its container; size the container.
- Use it only on the gut-check step. Everywhere else Bevi is flat \`surface\` with hairlines.
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
  CommentsSheet: `The post's comments, Instagram-clean, in a 90% Sheet titled "Comments".

- Provide: \`comments\` (each \`author\`, \`body\`, \`time\`, \`mine\`), \`me\` (the composer's avatar), \`onPost\`, \`onDelete\`, \`onClose\`, optional \`error\`.
- Order: oldest at the top, newest just above the composer, like a chat, and the same order as the post's inline comments. \`comments.list\` returns newest first, so the app reverses each page and loads older ones as you scroll up.
- A comment: Avatar 32, the bold handle and a relative time in \`textSecondary\` ("2 hours ago"), then the text in \`body\`, wrapped. Your own comments end in a "Delete" text button (44pt target, \`textSecondary\`, removed after a confirm in the app). No likes on comments.
- Empty: an EmptyState with \`message-circle\`, "No comments yet" and "Start the conversation."
- The composer is pinned to the bottom: your Avatar 32, a pill field "Add a comment…" (\`borderStrong\`, focus ring), and **Post** in \`primary\`, \`textSecondary\` and disabled while the field is empty. A comment is at most 280 characters: the remaining count appears beside Post from 20 left, and turns \`scoreLow\` and blocks Post below zero.
- When posting fails the draft stays and a \`scoreLow\` caption under the composer says why ("Couldn't post your comment. Check your connection and try again.", "… Wait a minute, then try again.").`,
};

const S = {
  ScreenFeed: `Feed tab (ref 01, 12): Header with the wordmark and Find people, the filled SearchBar, Bev of the day and Bev of the week side by side (BevOfCard), then "YOUR FEED" FeedPosts, over the TabBar.

- Following nobody: an EmptyState under YOUR FEED ("Follow friends to see their Bevs" + Find people); the Bev of the day and week stay.
- Each post carries the heart and the comment bubble; up to seven comments show under the action row, more collapse to "View all N comments".
- Dropped from Beli: quick-action pills, the composer, the invite card.`,
  ScreenYourLists: `Your Lists › Bev'd (ref 06): centred "YOUR LISTS" Header, ListScopeDropdown, SegmentedTabs, the FilterPill row, the ProgressStrip ("All Bevs · 37 of 378 tried · 9%"), SortToggle, then numbered BevRows sorted by score.

- Want to Try rows show the global score and a filled bookmark, with when or from whom you saved it in the meta line; Recommended rows show predicted bubbles and a reason in the meta line.`,
  ScreenSearch: `Search tab (TASKS.md decision 32): wordmark Header with the close circle, the outlined SearchBar "Search a Bev or a person", a "Snap it" Pill, then the map area filling the rest of the screen.

- Until the live New York City map (M-16) the area is a placeholder in \`input\`: the \`map\` icon, "Map coming soon" and one line on what will show there. No pins and no fake streets.
- The map area stays mounted while the results panel covers it, so the real map is created once per session, and it takes no gestures while the panel is up.`,
  ScreenSearchResults: `Search tab with the results panel up: focusing the bar slides the panel over the map area from under the bar (opacity and a short downward slide over \`base\`; under Reduce Motion it just appears), and a ghost **Cancel** joins the bar.

- Idle: Recents (the Bevs you opened) and "Suggested for you" (people). Typing (debounced 250ms): one query searches both, grouped under "BEVS" (BevRows with \`showImage\` and the rating count) and "PEOPLE" (UserRows with Follow); an empty group is left out, and nothing in either shows one empty state.
- A sticky "Can't find it? Add a new Bev" closes the panel's bottom and turns \`primary\` when no Bev matches. It always sits above the keyboard.
- Cancel (or clearing the bar, then Cancel) slides the panel away and leaves the map exactly where it was.`,
  ScreenGutCheck: `Ranking flow, step 1 (no reference): a BevGlow in the drink's colour fills the screen; the cutout floats at 200pt over its name, brand and category; "How was it?"; three BucketButtons in the tint material; a hint that comparisons come next.

- Choosing a bucket pours it, then moves on to comparisons. An empty bucket skips straight to the note: "First one in Loved".`,
  ScreenRanking: `Ranking flow, step 2 (no reference): ProgressDots and the close circle, "Which was better?", two CompareCards (new on top), "Too close to call" and Undo.

- After placement, the note step (ScreenRankingNote) reveals the score at once, then the result confirms it: ScoreBubble 56 and "#4 of 31 in Loved · 8.9".`,
  ScreenRankingNote: `Ranking flow, step 3 (no reference): Undo and the close circle, then the score the moment placement finishes: a ScoreBubble 72 over "#4 of 31 in Loved", in place of a title, because the note field takes focus and the keyboard covers the rest. Then "Optional. Your friends see it with your ranking.", the 140-character note, Save and Skip.

- First Bev in an empty bucket: the same bubble over "First one in Loved", and "Nothing to compare yet. Add a note if you like."
- Motion: the bubble pours in and its number counts up from the bucket's lower edge (7.0 Loved, 4.0 Fine, 0.0 Didn't like) to the score, both over \`pour\` (450ms). Under Reduce Motion the final number shows at once, with no count-up.
- The score shown is the one that will be saved (\`storedScore\` from @bevi/ranking); the result step's ScoreBubble 56 confirms it.`,
  ScreenBevDetail: `Bev detail (no reference): BevImage 155, name, brand, category and PriceTier; two stat cards (Bevi score with "5k ratings" under it, "You'd rate it" predicted); friends who've had it; Rank it and Want to Try Pills.

- Not enough rankings: the second bubble is \`locked\` with "Rank 3 Bevs to see your prediction".`,
  ScreenProfile: `Profile tab (ref 02, 03): name Header, Avatar 100, handle, counts, the outlined Button row, three ProfileListRows, two StatCards, Activity · Taste Profile tabs, then your FeedPosts.`,
  ScreenLeaderboard: `Leaderboard tab (no reference): centred "LEADERBOARD", Bevs · People tabs, the category scope, then numbered BevRows with the Bev's image (\`showImage\`) and the Bayesian score; "Your score 7.6" (or "Not ranked yet") in the meta line, with no rating count.

- People tab: UserRows with rank, points, Bevs and streak; your own row pinned and highlighted.`,
};

for (const [name, body] of Object.entries({ ...R, ...S })) {
  const dir = path.join(ROOT, 'project/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\n${body}\n`);
}
console.log('readmes', Object.keys(R).length + Object.keys(S).length);
