# TasteProfile

The Taste Profile tab's block (Profile, next to Activity): an optional one-line read-out over a TasteBar per category, high to low, on the 16pt gutter.

- Provide: `rows` (`{ categoryId, mean, rankingCount }`, from `stats.getTasteProfile(userId)`, already sorted by mean, highest first) and `readout`. It neither sorts nor writes the read-out, so the app owns both; empty `rows` render nothing and the screen shows its EmptyState.
- Read-out rule (the ranking paper's Taste Profile definition): "You prefer coffee and boba over soda" (or "Matt prefers…") appears only when both categories have 3 or more rankings and their means differ by at least 1. Without such a pair the line is left out.
- Categories the user hasn't ranked are not in `rows`; the alcoholic three never reach an under-21 viewer, or a viewer looking at an under-21 profile.
- Loading is a Skeleton, a failed load is an ErrorState with retry, and a user with no rankings gets "No taste profile yet" (their own) or "Their taste profile will show up here."
