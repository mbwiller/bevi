# NotificationRow

One line of the Notifications screen: who did it, what they did and how long ago, ending in the post's Bev or a Follow back pill.

- Provide: `kind` (follow, like or comment), `actors` (newest first), `time` as a short age ("2m", "3d", "2w"), and for a like or a comment the post's `bev`; a comment also takes its text in `comment`, quoted on up to two lines.
- Likes on one post share a row: pass the two latest people in `actors` and the total in `actorCount`, and it reads "priya, samo and 3 others liked your Diet Coke" beside a pair of 32pt avatars. Comments and follows are one row each.
- People are named by handle, in semibold; so is the Bev. The sentence is `body`, sentence case, with no full stop.
- `unread` tints the row `primaryTint` and adds a 6pt `primary` dot in the gutter. Colour is never the only signal: the spoken sentence starts with "Unread.", and unread rows sit under a "New" SectionHeader.
- A follow row ends in the pill: "Follow back" (filled) until you follow them, then "Following" (outlined). It pops when toggled, like every Follow pill.
- The row opens the post for a like, the post with its comments up for a comment, and the person's profile for a follow. The pill is its own target.
