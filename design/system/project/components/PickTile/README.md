# PickTile

One category in onboarding's "What are your go-tos?" step: a Bev's art over the category's label, in a three-column grid. Tap up to three, favorite first; the order they were tapped in is the ranking, and each picked tile shows its number.

- Provide: `label` (the category's label from `Bevi.categories`), `src` or `art` (the category's most-rated starter Bev, as BevImage takes it; the category's own BevArt when it has none), `rank` (1, 2 or 3 once picked), `disabled`, `onClick`.
- The grid: three equal columns on the 16pt gutter, 12pt apart, each row as tall as its tallest tile. A tile is BevImage 56 over the label in `body` at weight 600, centred, at most two lines, on `surface` with a 1pt `border` and `radius-card`. Offer every category the person can see except Other, in catalog order; never the alcoholic three to an under-21.
- **Picked:** `primaryTint` with a 2pt `primary` rim, and the number in a 26pt `primary` badge (`onPrimary` text, tabular) at the top right. The number carries the order, so the state never rests on colour, and the accessible name says it too: "Coffee, your number 1 pick", with `aria-pressed`.
- Tapping a picked tile drops it, and the later picks move up one: the badges renumber, nothing else moves.
- **Dimmed** (`disabled`, once three are picked): the unpicked tiles' art fades to 35% and their label goes `textSecondary`. A tap does nothing, and the accessible name says why ("Wine. You've picked 3 already"). The line under the grid says what to do instead: "That's your 3. Tap one to swap it out."
- Motion: the tile gives way under a press (Press), and the badge pops in when a tap picks it (Change, `base`). Reduce Motion drops the pop and the scale; the badge just appears.
