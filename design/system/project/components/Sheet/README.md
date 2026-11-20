# Sheet

Bottom sheet with a handle, over a `scrim`; snaps to 40% or 90% of the screen.

- Provide: `title`, `snap`, `onClose`, optional `onClosed`, children (option rows 48pt with 1pt dividers, a check in `primary` on the chosen one).
- Uses: list scope, filters, re-rank, category picker, report a Bev, settings.
- `onClosed` fires once the sheet has finished closing, after its exit animation and, on a phone, once the modal is really gone. Anything that follows a close (leaving the screen, opening a screen or another modal) waits for it: doing it in the same tick as `onClose` pops or pushes a screen under a modal that is still presented.
- A sheet that opens over another goes inside it (the second modal presents from the first); never beside it.
- It fills its nearest positioned ancestor: render it inside the screen container.
