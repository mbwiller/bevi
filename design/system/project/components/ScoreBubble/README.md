# ScoreBubble

Beli's score mark: a `surface` circle with a 2pt `border` ring and the score in bold, coloured by its bucket band.

- Provide: `score` (0–10; shown to one decimal), `size` 40 (rows, posts) or 56 (Bev detail, ranking result), optional `count` for the `primary` rating-count badge ("198", "5k").
- `variant="predicted"` = dotted ring and "~" prefix (Recommended, "You'd rate it"); `locked` = lock icon, no number (prediction confidence < 0.25, or fewer than 3 rankings).
- Bands: ≥ 7 `scoreHigh`, ≥ 4 `scoreMid`, else `scoreLow`. The number always shows, so colour is never the only signal.
