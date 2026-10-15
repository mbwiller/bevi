# BevRow

The ~126pt list row from Beli: name (optionally numbered), `$$ • Category`, category icon • brand, a meta line, Rank and Want to Try actions, and a ScoreBubble.

- Provide: `bev`, `number` (Bev'd and Leaderboard), `score` (`scoreVariant="predicted"` on Recommended), `meta` ("Ranked Oct 3", "Saved from @arjun", a recommendation reason), `count`, `saved`, `onRank`, `onSave`.
- The meta line is `meta` when the row has one. Only a row with no meta of its own (search results) prints the rating count there instead: "1 rating", "362 ratings", "5k ratings", even under a locked bubble, and nothing at 0. Leaderboard, Want to Try and Recommended rows keep just their own meta.
- No image by default, as in the reference; `showImage` adds a 56pt BevImage for search results and "Did you mean…".
- One list sorted by score: buckets show through the bubble colour, not as sections.
