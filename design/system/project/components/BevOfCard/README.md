# BevOfCard

Bev of the day or Bev of the week, a pair side by side under the Feed's search bar: a caps label, the Bev's square tile, its name and the score it won with. Just the Bev, never a post.

- Provide: `period` ("day" or "week"), `bev`, `score` (the Bayesian score it won with, set even when the Bev has a single rating), `date`, `onClick` (opens the Bev).
- The winner is the best Bayesian score among Bevs ranked that New York day or ISO week. When nobody ranked anything in the current period it is the latest period's winner, and `date` says which: "Oct 17", "Week of Oct 12". The current period shows no date.
- The pair splits the row between the gutters, with a 16pt gap; each card is half and its tile follows that width, so it fits any phone. No winner for either period: leave the row out. Only one: it keeps half the row, on the left.
- **The same Bev for both:** still two cards, one per period, each with its own label and date. Never one merged card: a lone card on the left reads as if the other winner were missing.
- The whole card is one button: "Bev of the day: Horchata, 8.9" (with the date when there is one). The name wraps to two lines.
