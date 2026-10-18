# FeedPost

A ranking in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**", meta line, ScoreBubble, a 155pt photo strip, notes and actions.

- Provide: `actor` (or `you` for "You"), `bev`, `score`, `note`, `time` ("5 hours ago", "Wednesday"), `saved`, `liked`, `likeCount`, `comments`, `commentCount`, `onLike`, `onComment`, `onRank`, `onSave`, `onOpen`.
- A post is always a ranking. Saving a Bev is not a post; the filled bookmark shows you already have it saved.
- The meta line under the name is the category icon and the brand (the category's name when there's no brand). No price on a post (D-06).
- Action row: the time on the left; on the right the LikeButton and the CommentButton, then Rank it and Want to Try. Heart and comment lead the group because they are about the post, while Rank and Want to Try are about the Bev.
- **Double-tap anywhere on the post outside the photo strip to like it**, Instagram-style. It only ever likes, never unlikes (the heart does that), and it is never the only way to like. A single tap on the photo still opens the Bev, so the strip ignores double-taps. The post sets `touch-action: manipulation` so Safari doesn't zoom on a double-tap.
- The burst: a 88pt filled `primary` heart grows over the photo strip (the post's centre when there is no photo), holds and fades within 800ms, transform and opacity only. Reduce Motion: a plain fade. It plays on every like by double-tap, even when the post was already liked.
- **Comments sit under the action row**, as on Instagram: the post (head, photos, note) reads first, the row of actions closes it, and the conversation follows. With 7 or fewer comments the post shows every one inline, oldest first, as "**handle** text" in `body` (`comments` is the contract's first seven). Above 7 it collapses to a single "View all N comments" line in `textSecondary`, with no preview, so a busy post stays one line taller, not seven. That line and the CommentButton both open the CommentsSheet.
- Notes over 160 characters truncate with "See more". Alcoholic Bevs from friends render without the Rank action for under-21 viewers.
