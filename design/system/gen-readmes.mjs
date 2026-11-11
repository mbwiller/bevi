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

- Provide: \`name\` (initials come from the first two words), \`src\` optional, \`size\` 24 (a comment inline on a post), 32 (tab bar, the comments sheet), 44 (people rows), 60 (feed posts), 100 (profile hero, initials 40pt light).
- \`ring\` adds a \`surface\` outline for overlapping stacks.
- The photo is the person's own upload (AvatarPicker); without one, the initials. The same circle, photo or initials, appears everywhere the person does: posts, comments, people rows, the leaderboard, people search, the tab bar.`,
  AvatarPicker: `Your own photo where it can be changed: Edit profile and the onboarding profile step. An Avatar 100 (the photo, or your initials) over a \`primary\` text button, "Add a photo" with no photo and "Change photo" with one, plus "Remove" in \`textSecondary\`.

- Provide: \`name\`, \`src\`, \`onChange\` (opens the photo picker: on the web the file input, which on an iPhone offers the camera or the library), \`onRemove\`, \`busy\` (a spinner over the circle while the picture uploads; both buttons disabled), \`error\` (a \`scoreLow\` caption: "Couldn't upload your photo. Try another one.").
- A chosen photo is saved as soon as it uploads, with no Save step: the circle shows the new picture at once and it appears everywhere the person's Avatar does. Removing goes back to initials.
- Photos are resized to 512pt on the longest edge and re-encoded as JPEG before upload (EXIF dropped), the same path as Bev photos at 1600pt.`,
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

- Provide: \`actor\` (or \`you\` for "You"), \`bev\`, \`score\`, \`note\`, \`time\` ("5 hours ago", "Wednesday"), \`saved\`, \`liked\`, \`likeCount\`, \`comments\`, \`commentCount\`, \`onLike\`, \`onComment\`, \`onRank\`, \`onSave\`, \`onOpen\`, and in Explore \`following\` and \`onFollow\`.
- Each action shows only with its handler: no \`onLike\` means no heart and no double-tap, no \`onComment\` no comment icon, and likewise Rank it and Want to Try.
- **The plain post** is a read-only ranking by someone you don't follow (Explore, and a stranger's Profile › Activity): head, photo strip and note, with no heart, no counts, no comments and no Rank it or Want to Try. Tapping the photo opens the Bev. Likes and comments stay between followers (D-15).
- **In Explore the plain post carries the author's Follow pill** (\`onFollow\`), UserRow's pill: filled \`primary\` "Follow", outlined "Following" once tapped, its accessible name "Follow" plus the author's name. It leads the action group, where the heart sits on a feed post, so a plain post and an Explore post are the same height.
- A post is always a ranking. Saving a Bev is not a post; the filled bookmark shows you already have it saved.
- The meta line under the name is the category icon and the brand (the category's name when there's no brand). No price on a post (D-06).
- Action row: the time on the left; on the right the LikeButton and the CommentButton, then Rank it and Want to Try. Heart and comment lead the group because they are about the post, while Rank and Want to Try are about the Bev.
- **Double-tap anywhere on the post outside the photo strip to like it**, Instagram-style. It only ever likes, never unlikes (the heart does that), and it is never the only way to like. A single tap on the photo still opens the Bev, so the strip ignores double-taps. The post sets \`touch-action: manipulation\` so Safari doesn't zoom on a double-tap.
- The burst: a 88pt filled \`primary\` heart grows over the photo strip (the post's centre when there is no photo), holds and fades within 800ms, transform and opacity only. Reduce Motion: a plain fade. It plays on every like by double-tap, even when the post was already liked.
- **Comments sit under the action row**, as on Instagram: the post (head, photos, note) reads first, the row of actions closes it, and the conversation follows. With 7 or fewer comments the post shows every one inline, oldest first, each as its author's Avatar 24 then "**handle** text" in \`body\`, like Instagram (\`comments\` is the contract's first seven). Above 7 it collapses to a single "View all N comments" line in \`textSecondary\`, with no preview, so a busy post stays one line taller, not seven. That line and the CommentButton both open the CommentsSheet.
- Notes over 160 characters truncate with "See more". Alcoholic Bevs from friends render without the Rank action for under-21 viewers.`,
  FeaturedCard: `164pt square photo card for the Featured carousel: image, a \`photoScrim\` gradient, white 20pt title and 15pt subtitle.

- Provide: \`title\`, \`subtitle\` (category + "$" for a Bev, "You've had 3 of 10" for a list), \`src\` or \`art\` with a \`tint\` backdrop.
- Carousel gap 16pt under a SectionHeader with "See all".
- Not on the Feed since M-05: Bev of the day and Bev of the week (BevOfCard) took its slot under the search bar.`,
  BevOfCard: `Bev of the day or Bev of the week, a pair side by side under the Feed's search bar: a caps label, the Bev's square tile, its name and the score it won with. Just the Bev, never a post.

- Provide: \`period\` ("day" or "week"), \`bev\`, \`score\` (the Bayesian score it won with, set even when the Bev has a single rating), \`date\`, \`onClick\` (opens the Bev).
- The winner is the best Bayesian score among Bevs ranked that New York day or ISO week. When nobody ranked anything in the current period it is the latest period's winner, and \`date\` says which: "Oct 17", "Week of Oct 12". The current period shows no date.
- The pair splits the row between the gutters, with a 16pt gap; each card is half and its tile follows that width, so it fits any phone. No winner for either period: leave the row out. Only one: it keeps half the row, on the left.
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
  ProgressBar: `A 4pt progress track in \`input\` with a \`primary\` fill: a share you earned. Used by the ProgressStrip, the CollectionSheet and the TasteBar.

- Provide: \`value\` 0–1 (clamped), \`tone\` ("primary" by default; "scoreHigh", "scoreMid" or "scoreLow" fill it in a score band, which only the TasteBar does).
- Decorative and hidden from screen readers: the text beside it always says the number.`,
  TasteBar: `One category of a Taste Profile: its icon and label, "8.1 · 9 ranked" on the right and a 4pt bar under it filled to the average score out of 10.

- Provide: \`categoryId\` (icon and label come from \`Bevi.categories\`), \`mean\` (0–10, the user's average score there), \`rankingCount\`.
- The score and the bar take the score band's colour (7 and up \`scoreHigh\`, 4 and up \`scoreMid\`, else \`scoreLow\`); " · 9 ranked" stays \`textSecondary\`. The number always shows, so colour is never the only signal.
- Not a button: a 44pt row that a screen reader hears as one sentence, "Coffee, average 8.1, 9 ranked".`,
  TasteProfile: `The Taste Profile tab's block (Profile, next to Activity): an optional one-line read-out over a TasteBar per category, high to low, on the 16pt gutter.

- Provide: \`rows\` (\`{ categoryId, mean, rankingCount }\`, from \`stats.getTasteProfile(userId)\`, already sorted by mean, highest first) and \`readout\`. It neither sorts nor writes the read-out, so the app owns both; empty \`rows\` render nothing and the screen shows its EmptyState.
- Read-out rule (the ranking paper's Taste Profile definition): "You prefer coffee and boba over soda" (or "Matt prefers…") appears only when both categories have 3 or more rankings and their means differ by at least 1. Without such a pair the line is left out.
- Categories the user hasn't ranked are not in \`rows\`; the alcoholic three never reach an under-21 viewer, or a viewer looking at an under-21 profile.
- Loading is a Skeleton, a failed load is an ErrorState with retry, and a user with no rankings gets "No taste profile yet" (their own) or "Their taste profile will show up here."`,
  CollectionSheet: `"Your collection": a 90% Sheet with every category the viewer can see, in catalog order, each with its icon, "9 of 40" and the same 4pt bar.

- Provide: \`rows\` (\`{ categoryId, ranked, total }\`: the contract's \`CategoryProgress\`, from \`stats.getCategoryProgress()\`), \`onSelect\` (called with the \`categoryId\`), \`onClose\`. Categories with nothing in them are left out; the alcoholic three never reach an under-21 viewer.
- The sheet opens on the overall line ("37 of 378 tried · 9%"). Catalog order stays put as you rank, so a bar never jumps rows.
- Tapping a row scopes Bev'd to that category and closes the sheet.`,
  UserRow: `A person row for People search, followers lists and the user leaderboard.

- Provide: \`user\` ({ name, handle }), \`meta\` ("84 Bevs", "212 pts"), optional \`rank\` and \`streak\`, \`following\` to show the Follow/Following pill, \`self\` to highlight your own row in \`primaryTint\`.
- Pin your own row at the bottom of the leaderboard when it's off screen.`,
  BucketButton: `Gut-check choice in the ranking flow: a \`primary\` ring filled to a level, over its label. Loved is full, fine is half, disliked is empty, so the order reads without colour.

- Provide: \`bucket\` (loved, fine, disliked), \`selected\`, \`dimmed\`, \`onClick\`. Always show all three, in that order, in one row of three equal columns on the 16pt gutter, under a centred "How was it?".
- Labels are fixed: "Loved it", "It was okay", "Not for me", in \`body\` at weight 600, centred under the ring. The label always shows.
- The ring is 76pt with a 2.5pt \`primary\` border and a 4pt gap to the fill. One colour only: no score colours, no faces, no gradient, no shadow, and nothing blurred behind the row. It sits on plain \`surface\`.
- Chosen: a 26pt check badge (\`text\` on a 3pt \`surface\` gap) at the ring's top right. Pass \`dimmed\` to the other two: the ring drops to 35% and the label goes \`textSecondary\`.
- Motion: the ring presses to 94% and the badge scales in over \`fast\` (150ms). Reduce Motion shows the badge at once.
- Don't add a fourth option, colour the rings by bucket, or tint the label.`,
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
  MapCallout: `A venue's pin on the Search tab's map (Beli's Recs callout): a white pill on \`elevation-floating\` with a 28pt grape circle holding the venue kind's glyph, the score in bold, and a 6pt tail pointing at the spot.

- Provide: \`score\` (the best Bayesian score of the Bevs the venue carries; the predicted score only when none of them has one), \`predicted\`, \`kind\` (\`chain\` = \`store\`, \`craft\` = \`coffee\`), \`selected\`, \`label\`.
- \`predicted\` = a dotted ring on the circle and a "~" before the number, as on ScoreBubble. No score at all = "–" in \`textSecondary\`.
- \`selected\` (the venue whose VenueSheet is open): raised 4pt, 1.15× larger, a \`primary\` rim, and above every other pin. It grows in \`fast\`; under Reduce Motion it just changes.
- The number stays \`text\`: a pin is about a place, so it never takes a score-band colour, and it always shows its number.
- The whole pin is at least 44 × 44. Its accessible name starts with the venue's name ("Yorkville Coffee Works, craft, score 8.8"); the markup itself never carries venue text.
- Pins overlap at every zoom and never cluster, as on Beli; the server caps how many come back per zoom.
- Reserved: a \`badge\` slot at the top right for ↗ trending and a bookmark (a Want to Try Bev is sold here), once the contract has them. No teardrops: "your score" pins went with the venue step (2026-10-19).`,
  MapFilterRow: `The filters over the map, one row that scrolls sideways: \`Filters N\`, \`Neighborhood ▾\`, \`Category ▾\`, \`Price ▾\`, \`Open now\` and \`Retailer ▾\`.

- Provide: \`count\` (facets that are on, for "Filters N"), each facet's picked label (\`neighborhood\`, \`category\`, \`price\`, \`retailer\`; '' for nothing), \`openNow\`, \`neighborhoods\` (false leaves the Neighborhood pill out), and a handler per pill.
- \`Filters N\` is the FilterPill with its label; it opens one 90% Sheet with every filter and "Reset filters".
- Each ▾ pill opens a multi-select Sheet (a check per picked option, "Any …" at the top to clear it). Its label becomes what is picked: "Coffee", "Coffee +2", "$, $$", "Chains", "Chains, Craft". Picking nothing means no filter.
- \`Open now\` toggles on the spot. It keeps only venues whose hours we could read and that are open; "Hours unknown" venues drop out while it is on.
- A pill that is on takes the selected look of an outlined Pill and the FilterPill (\`primaryTint\`, \`primary\` rim and text).
- Category offers the categories the viewer can see (never the alcoholic three under 21). Neighborhood is left out while the vocabulary is empty.
- Pills keep their 44pt targets inside the row: it pads 7pt above and below.`,
  MapControls: `The map's floating controls. Inline under the search bar: the filter row on top, and a round "open the full map" button over the \`View List\` pill at the bottom right. Full screen: \`List | Map\` with the close button on top, the filter row under them, and the round locate button over \`View List\`.

- Provide: \`expanded\`, \`mode\` (\`map\` or \`list\`) and \`onModeChange\`, \`onExpand\`, \`onClose\`, \`onLocate\`, \`located\` (the blue dot is up: the arrow turns \`primary\`), \`locating\`, \`onViewList\`, and the MapFilterRow as \`children\`.
- \`List | Map\` is a segmented control on a \`primary\` rim: the side that is on is filled \`primary\` with \`onPrimary\` text, the other reads \`primary\` on \`surface\`, as Beli fills its teal. No people button: friends' pins went with the venue step.
- \`View List\` is a 44pt filled \`primary\` pill. In list mode the corner buttons go; \`List | Map\` brings the map back.
- Tapping a pin, \`View List\` or "open the full map" opens the same map full screen; the close button (or Escape) returns to the inline map exactly where it was.
- Everything sits clear of Google's logo (bottom left), Google's terms (bottom right) and the OpenStreetMap credit above the logo: the corner stack starts 36pt up.
- Round buttons are 44pt \`surface\` circles with a hairline and \`elevation-floating\`, so they hold up over any tile. Locate asks for the position only when tapped, never on load, and it stays on the device.`,
  VenueRow: `A venue in the map's List view: its name, "Craft · Yorkville", "Open now · 3 Bevs", and the pin's score in a ScoreBubble (predicted when the pin's is).

- Provide: \`venue\`, \`openNow\`, \`score\`, \`predicted\`, \`bevs\`, \`onClick\` (switches to the map, centred on the venue, with its VenueSheet open).
- The list is the venues in view, in the order the map asked for them (best first). No score yet: no bubble.
- One button per row, its name read first.`,
  VenueSheet: `The tapped venue, docked under the full-screen map: the map shrinks above it, so the raised pin, Google's logo and the OpenStreetMap credit stay in view, and the map keeps panning.

- Order: the name (\`screenTitle\`) with the close circle; "Craft · Yorkville · Manhattan"; the open state with \`clock\` ("Open now", "Closed", "Hours unknown"; never "closed" for hours we couldn't read); the address with \`map-pin\`; the website as a \`primary\` link (its host, opening in a new tab); then "Bevs here (N)" and a BevRow per Bev; last, "© OpenStreetMap contributors" as a caption.
- Each BevRow shows your score if you ranked the Bev (meta "Your score"), else your predicted score ("You'd rate it", dotted ring), else its Bayesian score with the rating count. Rank it and Want to Try as everywhere; tapping a row opens the Bev.
- Loading: the pin's name, kind and open state fill the header at once, "Bevs here (N)" uses the pin's count, and Skeleton rows hold the list.
- Gone since the pin was drawn (\`not_found\`): "This spot isn't here anymore". Any other failure: an ErrorState with Retry.
- About 40% of the screen; it scrolls inside. Closing it (the close circle, Escape, a tap on the map) clears the selection.`,
};

const S = {
  ScreenFeed: `Feed tab (ref 01, 12): Header with the wordmark and Find people, the filled SearchBar, Bev of the day and Bev of the week side by side (BevOfCard), then SegmentedTabs "Your feed · Explore" and that segment's FeedPosts, over the TabBar.

- The tabs replace the YOUR FEED section header, in the same place: under the Bev of the day and week, which stay on both segments. Text tabs (\`underline-text\`), as on Your lists and the Leaderboard. "Your feed" is the default.
- **Your feed:** followed people's rankings, newest first. Each post carries the heart and the comment bubble; up to seven comments show under the action row, more collapse to "View all N comments". Following nobody: an EmptyState under the tabs ("Follow friends to see their Bevs" + Find people).
- **Explore:** rankings by people you don't follow yet, up to two follows away (everyone while Bevi is small), the most liked first rather than the newest. Each is the plain post (no heart, counts or comments) with the author's Follow pill. A followed author's posts stay, marked "Following", until Explore reloads; then they move to Your feed. Nothing yet: an EmptyState with \`sparkles\` ("Nothing popular yet", "Popular Bevs from people you don't follow show up here").
- Dropped from Beli: quick-action pills, the composer, the invite card.`,
  ScreenYourLists: `Your Lists › Bev'd (ref 06): centred "YOUR LISTS" Header, ListScopeDropdown, SegmentedTabs, the FilterPill row, the ProgressStrip ("All Bevs · 37 of 378 tried · 9%"), SortToggle, then numbered BevRows sorted by score.

- Want to Try rows show the global score and a filled bookmark, with when or from whom you saved it in the meta line; Recommended rows show predicted bubbles and a reason in the meta line.`,
  ScreenSearch: `Search tab (TASKS.md decision 32, M-16): wordmark Header with the close circle, the outlined SearchBar "Search a Bev or a person", a "Snap it" Pill, then the live map of New York City filling the rest of the screen. The preview shows it inline (left) and full screen (right).

- **Inline:** the map pans and zooms in place, with the MapFilterRow on top and the MapControls corner (open the full map, \`View List\`). Venue pins are MapCallouts.
- **Full screen:** tapping a pin, \`View List\` or "open the full map" opens the same map over the whole screen with the full chrome: \`List | Map\`, the close button, the filters, locate and \`View List\`; a tapped pin docks its VenueSheet below. The close button or Escape returns to the inline map where it was. Focus stays inside while it is open.
- One Google map per visit to the app: inline and full screen borrow the same map, so its viewport carries across, and leaving the tab never reloads it.
- The map area stays mounted while the results panel covers it, and it takes no gestures while the panel is up.
- Without a Google key in the build (and only then) the area is the placeholder: the \`map\` icon, "Map coming soon" and one line on what will show there. If Google fails to load or rejects the key: "Map unavailable right now". Never Google's grey box.`,
  ScreenSearchResults: `Search tab with the results panel up: focusing the bar slides the panel over the map area from under the bar (opacity and a short downward slide over \`base\`; under Reduce Motion it just appears), and a ghost **Cancel** joins the bar.

- Idle: Recents (the Bevs you opened) and "Suggested for you" (people). Typing (debounced 250ms): one query searches both, grouped under "BEVS" (BevRows with \`showImage\` and the rating count) and "PEOPLE" (UserRows with Follow); an empty group is left out, and nothing in either shows one empty state.
- A sticky "Can't find it? Add a new Bev" closes the panel's bottom and turns \`primary\` when no Bev matches. It always sits above the keyboard.
- Cancel (or clearing the bar, then Cancel) slides the panel away and leaves the map exactly where it was.`,
  ScreenGutCheck: `Ranking flow, step 1 (no reference): plain \`surface\`; the cutout floats at 200pt over its name, brand and category; a centred "How was it?"; three BucketButtons in a row; a hint that comparisons come next.

- Choosing a bucket checks it and fades the other two, then moves on to comparisons. An empty bucket skips straight to the note: "First one in Loved".`,
  ScreenRanking: `Ranking flow, step 2 (no reference): ProgressDots and the close circle, "Which was better?", two CompareCards (new on top), "Too close to call" and Undo.

- After placement, the note step (ScreenRankingNote) reveals the score at once, then the result confirms it: ScoreBubble 56 and "#4 of 31 in Loved · 8.9".`,
  ScreenRankingNote: `Ranking flow, step 3 (no reference): Undo and the close circle, then the score the moment placement finishes: a ScoreBubble 72 over "#4 of 31 in Loved", in place of a title, because the note field takes focus and the keyboard covers the rest. Then "Optional. Your friends see it with your ranking.", the 140-character note, Save and Skip.

- First Bev in an empty bucket: the same bubble over "First one in Loved", and "Nothing to compare yet. Add a note if you like."
- Motion: the bubble pours in and its number counts up from the bucket's lower edge (7.0 Loved, 4.0 Fine, 0.0 Didn't like) to the score, both over \`pour\` (450ms). Under Reduce Motion the final number shows at once, with no count-up.
- The score shown is the one that will be saved (\`storedScore\` from @bevi/ranking); the result step's ScoreBubble 56 confirms it.`,
  ScreenBevDetail: `Bev detail (no reference): BevImage 155, name, brand, category and PriceTier; two stat cards (Bevi score with "5k ratings" under it, "You'd rate it" predicted); friends who've had it; Rank it and Want to Try Pills; "Bevs like this"; "Added by". The preview shows two phones: the top of the screen, then the same screen scrolled to the new row (the Header stays put).

- Not enough rankings: the second bubble is \`locked\` with "Rank 3 Bevs to see your prediction".
- **Bevs like this** (M-27): a \`SectionHeader\` ("Bevs like this", no action) under Rank it, Want to Try and the nutrition label, then up to 5 \`BevRow\`s, most similar first, from \`bevs.similar(bevId, 5)\`. Each row has its image (\`showImage\`; the \`BevArt\` placeholder where there is no photo), no Rank or Want to Try buttons (\`actions={false}\`: the row only opens a Bev, and its own detail has both), the Bayesian score in the bubble and the rating count as the meta line, the same as search results. The bubble is \`locked\` while the Bev has fewer than \`MIN_RATERS\` rankings. No number: this is a set, not a ranking. Tapping a row opens that Bev's detail (pushed, so Back returns here).
- **Hidden entirely** when there are no neighbours, while it loads, and if the request fails: no header, no empty state, no error. It is secondary content, so it never makes the page jump or shout. The current Bev is never in its own list, and under-21 viewers never see an alcoholic neighbour.`,
  ScreenProfile: `Profile tab (ref 02, 03): name Header, Avatar 100, handle, counts, the outlined Button row, three ProfileListRows, two StatCards, Activity · Taste Profile tabs, then your FeedPosts. The Taste Profile tab swaps the posts for a TasteProfile: the read-out over the category bars.`,
  ScreenLeaderboard: `Leaderboard tab (no reference): centred "LEADERBOARD", Bevs · People tabs, the category scope, then numbered BevRows with the Bev's image (\`showImage\`) and the Bayesian score; "Your score 7.6" (or "Not ranked yet") in the meta line, with no rating count.

- People tab: UserRows with rank, points, Bevs and streak; your own row pinned and highlighted.`,
};

for (const [name, body] of Object.entries({ ...R, ...S })) {
  const dir = path.join(ROOT, 'project/components', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\n${body}\n`);
}
console.log('readmes', Object.keys(R).length + Object.keys(S).length);
