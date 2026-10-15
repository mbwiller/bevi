# FeedPost

A ranking in the Feed and on Profile › Activity: "**Arjun** Bev'd **Horchata**", meta line, ScoreBubble, a 155pt photo strip, notes and actions.

- Provide: `actor` (or `you` for "You"), `bev`, `score`, `note`, `time` ("5 hours ago", "Wednesday"), `saved`, `liked`, `likeCount`, `onLike`, `onRank`, `onSave`, `onOpen`.
- A post is always a ranking. Saving a Bev is not a post; the filled bookmark shows you already have it saved.
- Action row: the time on the left; on the right the LikeButton, then Rank it and Want to Try. The heart leads the group because liking is about the post, while Rank and Want to Try are about the Bev. Comments (next) sit beside the heart.
- **Double-tap anywhere on the post outside the photo strip to like it**, Instagram-style. It only ever likes, never unlikes (the heart does that), and it is never the only way to like. A single tap on the photo still opens the Bev, so the strip ignores double-taps. The post sets `touch-action: manipulation` so Safari doesn't zoom on a double-tap.
- The burst: a 88pt filled `primary` heart grows over the photo strip (the post's centre when there is no photo), holds and fades within 800ms, transform and opacity only. Reduce Motion: a plain fade. It plays on every like by double-tap, even when the post was already liked.
- Notes over 160 characters truncate with "See more". Alcoholic Bevs from friends render without the Rank action for under-21 viewers.
