# ProgressBar

A 4pt progress track in `input` with a `primary` fill: a share you earned. Used by the ProgressStrip, the CollectionSheet and the TasteBar.

- Provide: `value` 0–1 (clamped), `tone` ("primary" by default; "scoreHigh", "scoreMid" or "scoreLow" fill it in a score band, which only the TasteBar does).
- Decorative and hidden from screen readers: the text beside it always says the number.
