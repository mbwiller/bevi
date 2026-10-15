# CommentsSheet

The post's comments, Instagram-clean, in a 90% Sheet titled "Comments".

- Provide: `comments` (each `author`, `body`, `time`, `mine`), `me` (the composer's avatar), `onPost`, `onDelete`, `onClose`, optional `error`.
- Order: oldest at the top, newest just above the composer, like a chat, and the same order as the post's inline comments. `comments.list` returns newest first, so the app reverses each page and loads older ones as you scroll up.
- A comment: Avatar 32, the bold handle and a relative time in `textSecondary` ("2 hours ago"), then the text in `body`, wrapped. Your own comments end in a "Delete" text button (44pt target, `textSecondary`, removed after a confirm in the app). No likes on comments.
- Empty: an EmptyState with `message-circle`, "No comments yet" and "Start the conversation."
- The composer is pinned to the bottom: your Avatar 32, a pill field "Add a comment…" (`borderStrong`, focus ring), and **Post** in `primary`, `textSecondary` and disabled while the field is empty. A comment is at most 280 characters: the remaining count appears beside Post from 20 left, and turns `scoreLow` and blocks Post below zero.
- When posting fails the draft stays and a `scoreLow` caption under the composer says why ("Couldn't post your comment. Check your connection and try again.", "… Wait a minute, then try again.").
