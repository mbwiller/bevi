# ProgressStrip

Bev'd's progress line under the filter row: "Soda · 4 of 61 tried · 6%" over a 4pt bar, a chevron, and a tap that opens the CollectionSheet.

- Provide: `label` (the scoped category, or "All Bevs"), `ranked` and `total` from `stats.getCategoryProgress()` (all categories summed for "All Bevs"), `onClick`.
- The percentage rounds **down** and never reads a misleading 0%: "<1%" once anything is tried, "0%" when nothing is. An empty category drops the percentage.
- The bar is `input` with a `primary` fill, because it is a share you earned (the README's rule for grape). It is decorative; the line and the spoken label carry the number ("Soda, 4 of 61 tried, 6 percent. Show your collection").
- While the numbers load, a one-line Skeleton holds the strip's place; if they fail, the strip is left out rather than showing a wrong count.
