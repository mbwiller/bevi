# CommentButton

The post's comment control, Instagram's speech bubble, right after the heart: a 28pt `message-circle` outline in `text` with the comment count beside it.

- Provide: `count` (all comments on the post, printed like other counts: "3", "5k"; hidden at 0), `onClick` to open the comments sheet.
- Accessible name "Comment", plus the count when there is one ("Comment, 3 comments"). The target is at least 44pt; the count sits inside it.
- It has no on state and never turns grape: commenting is not a value you earned, and the heart stays the only grape icon in the row.
- No likes on comments.
