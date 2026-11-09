# MapCallout

A venue's pin on the Search tab's map (Beli's Recs callout): a white pill on `elevation-floating` with a 28pt grape circle holding the venue kind's glyph, the score in bold, and a 6pt tail pointing at the spot.

- Provide: `score` (the best Bayesian score of the Bevs the venue carries; the predicted score only when none of them has one), `predicted`, `kind` (`chain` = `store`, `craft` = `coffee`), `selected`, `label`.
- `predicted` = a dotted ring on the circle and a "~" before the number, as on ScoreBubble. No score at all = "–" in `textSecondary`.
- `selected` (the venue whose VenueSheet is open): raised 4pt, 1.15× larger, a `primary` rim, and above every other pin. It grows in `fast`; under Reduce Motion it just changes.
- The number stays `text`: a pin is about a place, so it never takes a score-band colour, and it always shows its number.
- The whole pin is at least 44 × 44. Its accessible name starts with the venue's name ("Yorkville Coffee Works, craft, score 8.8"); the markup itself never carries venue text.
- Pins overlap at every zoom and never cluster, as on Beli; the server caps how many come back per zoom.
- Reserved: a `badge` slot at the top right for ↗ trending and a bookmark (a Want to Try Bev is sold here), once the contract has them. No teardrops: "your score" pins went with the venue step (2026-10-19).
