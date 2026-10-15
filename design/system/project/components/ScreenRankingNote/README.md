# ScreenRankingNote

Ranking flow, step 3 (no reference): Undo and the close circle, then the score the moment placement finishes: a ScoreBubble 72 over "#4 of 31 in Loved", in place of a title, because the note field takes focus and the keyboard covers the rest. Then "Optional. Your friends see it with your ranking.", the 140-character note, Save and Skip.

- First Bev in an empty bucket: the same bubble over "First one in Loved", and "Nothing to compare yet. Add a note if you like."
- Motion: the bubble pours in and its number counts up from the bucket's lower edge (7.0 Loved, 4.0 Fine, 0.0 Didn't like) to the score, both over `pour` (450ms). Under Reduce Motion the final number shows at once, with no count-up.
- The score shown is the one that will be saved (`storedScore` from @bevi/ranking); the result step's ScoreBubble 56 confirms it.
