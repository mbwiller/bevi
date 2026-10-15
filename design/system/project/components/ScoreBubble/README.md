# ScoreBubble

Beli's score mark: a `surface` circle with a 2pt `border` ring and the score in bold, coloured by its bucket band.

- Provide: `score` (0–10; shown to one decimal), `size` 40 (rows, posts), 56 (Bev detail, ranking result) or 72 (the ranking note step, where the score is revealed the moment placement finishes).
- No count on the bubble: a badge read like a vote tally. A Bev's rating count is words in a meta line instead (BevRow's `count`, the Bev detail tile's "5k ratings").
- `variant="predicted"` = dotted ring and "~" prefix (Recommended, "You'd rate it"); `locked` = lock icon, no number (prediction confidence < 0.25, or fewer than 3 rankings).
- Bands: ≥ 7 `scoreHigh`, ≥ 4 `scoreMid`, else `scoreLow`. The number always shows, so colour is never the only signal.
