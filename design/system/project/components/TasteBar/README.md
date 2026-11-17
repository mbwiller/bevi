# TasteBar

One category of a Taste Profile: its icon and label, "8.1 · 9 ranked" on the right and a 4pt bar under it filled to the average score out of 10.

- Provide: `categoryId` (icon and label come from `Bevi.categories`), `mean` (0–10, the user's average score there), `rankingCount`.
- The score and the bar take the score band's colour (7 and up `scoreHigh`, 4 and up `scoreMid`, else `scoreLow`); " · 9 ranked" stays `textSecondary`. The number always shows, so colour is never the only signal.
- Not a button: a 44pt row that a screen reader hears as one sentence, "Coffee, average 8.1, 9 ranked".
