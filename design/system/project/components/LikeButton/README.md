# LikeButton

The post's like control, Instagram's heart: a 28pt `heart`, outline in `text` until liked, then filled `primary`, with the like count beside it.

- Provide: `liked`, `count` (printed like other counts: "12", "5k"; hidden at 0), `onClick` to toggle.
- Accessible name "Like" or "Unlike", plus the count when there is one ("Unlike, 12 likes"), and `aria-pressed`. The target is at least 44pt; the count sits inside it.
- A press pops the heart to 1.2× and back in `fast` (150ms), transform only; Reduce Motion drops the pop.
- The count stays `text`: only the heart turns grape, like the saved bookmark.
- It lives in FeedPost's action row. Liking by double-tap and its burst belong to FeedPost.
