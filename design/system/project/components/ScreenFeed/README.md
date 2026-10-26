# ScreenFeed

Feed tab (ref 01, 12): Header with the wordmark and Find people, the filled SearchBar, Bev of the day and Bev of the week side by side (BevOfCard), then SegmentedTabs "Your feed · Explore" and that segment's FeedPosts, over the TabBar.

- The tabs replace the YOUR FEED section header, in the same place: under the Bev of the day and week, which stay on both segments. Text tabs (`underline-text`), as on Your lists and the Leaderboard. "Your feed" is the default.
- **Your feed:** followed people's rankings, newest first. Each post carries the heart and the comment bubble; up to seven comments show under the action row, more collapse to "View all N comments". Following nobody: an EmptyState under the tabs ("Follow friends to see their Bevs" + Find people).
- **Explore:** rankings by people you don't follow yet, up to two follows away (everyone while Bevi is small), the most liked first rather than the newest. Each is the plain post (no heart, counts or comments) with the author's Follow pill. A followed author's posts stay, marked "Following", until Explore reloads; then they move to Your feed. Nothing yet: an EmptyState with `sparkles` ("Nothing popular yet", "Popular Bevs from people you don't follow show up here").
- Dropped from Beli: quick-action pills, the composer, the invite card.
