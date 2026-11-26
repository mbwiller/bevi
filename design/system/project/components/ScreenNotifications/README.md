# ScreenNotifications

Notifications (pushed from the Feed header's bell): Header with Back and "Notifications", then NotificationRows under "NEW", "TODAY", "THIS WEEK" and "EARLIER", over the TabBar with Feed marked.

- **What is listed:** someone followed you, liked a Bev you posted, or commented on it. Likes on one post are one row. Nothing else lands here.
- **Sections:** "New" holds everything unread. Read rows fall under "Today", "This week" (the last seven days) or "Earlier". A section with no rows is not drawn.
- **Reading:** opening the screen marks everything read and clears the bell's count at once. The rows keep their tint until you leave, so you can see what was new.
- **Going away:** a row disappears when what it reports is no longer true (they unfollowed, took the like back or deleted the comment), when the post is gone, and when either of you has blocked the other.
- **Empty:** EmptyState with the bell, "No notifications yet", and Find people, which opens People.
- Loading shows Skeleton rows; a failure shows ErrorState with Retry. Pull down to refresh.
