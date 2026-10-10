# BevRow

The ~126pt list row from Beli: name (optionally numbered), `$$ • Category`, category icon • brand, a meta line, Rank and Want to Try actions, and a ScoreBubble.

- Provide: `bev`, `number` (Bev'd and Leaderboard), `score` (+ `count` for global scores, `scoreVariant="predicted"` on Recommended), `meta` ("Ranked Oct 3", "Saved from @arjun", a recommendation reason), `saved`, `onRank`, `onSave`.
- No image by default, as in the reference; `showImage` adds a 56pt BevImage for search results and "Did you mean…".
- One list sorted by score: buckets show through the bubble colour, not as sections.
