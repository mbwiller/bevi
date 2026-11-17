# BevRow

The list row, about 94pt: an optional 56pt image, the name (optionally numbered) and one secondary line (category icon, then "Category · Brand"), a ScoreBubble, and a foot with the meta line on the left and Rank it and Want to Try on the right.

- Provide: `bev`, `number` (Bev'd and Top), `score` (`scoreVariant="predicted"` on For you), `meta` ("Ranked Oct 3", "Saved from @arjun", a recommendation reason), `count`, `saved`, `onRank`, `onSave`.
- **The foot sits directly under the category line**, from the text column's left edge to the row's right edge: beside the picture when there is one, across the row when there isn't. Its line is 32pt; the action buttons keep their 44pt targets and overlap it by 6pt above and below. This is what took the row from 126pt to 94pt, with the same content.
- The meta line is `meta` when the row has one. Only a row with no meta of its own (search results, Popular on Bevi) prints the rating count there instead: "1 rating", "362 ratings", "5k ratings", even under a locked bubble, and nothing at 0. Top, Want to Try and For you rows keep just their own meta.
- No image by default, as in the reference; `showImage` adds a 56pt BevImage for search results, "Did you mean…", Popular on Bevi and Top. The picture opens the Bev too, but the name is the one button a screen reader meets.
- **One secondary line, no price.** "Soda · Coca-Cola" after the category icon; just the category when there's no brand. The flavour joins the brand ("LaCroix · Pamplemousse") unless it is "Original". The price tier stays off rows (D-06).
- One list sorted by score: buckets show through the bubble colour, not as sections.
- A press gives way a little (scale 0.98, opacity 0.7 over `fast`), and the bookmark pops when it is toggled, like the heart.
