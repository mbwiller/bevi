# Sheet

Bottom sheet with a handle, over a `scrim`; snaps to 40%, 60% or 90% of the screen.

- Provide: `title`, `snap`, `onClose`, optional `onClosed` and `expand`, children (option rows 48pt with 1pt dividers, a check in `primary` on the chosen one).
- **Dragging it.** The handle and the title are the grab area: the sheet follows the finger, and the scrim fades as it goes down. Letting go is judged by where the release was heading, not by where the finger lifted: a list flicked at that speed would coast so far, and the sheet goes to the resting place nearest to that point, closing once it is heading more than about a third of the way to the bottom edge. So a quick flick closes it however short, and a small slow drag goes back. It carries on at the finger's own speed and settles without a wobble; pulled above its top it only gives a little.
- **`expand`** gives it a second resting height, the whole screen below the status bar. It opens at `snap`; its top drags up to the whole screen and back; from the whole screen a quick swipe down closes it outright and a slower one stops at `snap`. It takes the whole screen by itself while the keyboard is up. What is pinned to its bottom (a composer) stays on the bottom edge of the screen at either height and all the way between them. For a sheet people stay in: the CommentsSheet. Option sheets do not expand.
- Uses: list scope, filters, re-rank, category picker, report a Bev, settings.
- `onClosed` fires once the sheet has finished closing, after its exit animation and, on a phone, once the modal is really gone. Anything that follows a close (leaving the screen, opening a screen or another modal) waits for it: doing it in the same tick as `onClose` pops or pushes a screen under a modal that is still presented.
- A sheet that opens over another goes inside it (the second modal presents from the first); never beside it.
- It fills its nearest positioned ancestor: render it inside the screen container.
