# IconButton

A bare 28pt outline icon with a 44pt target, or the grey 32pt close circle.

- Provide: `icon`, `label` (required: it is the accessible name), `variant` (plain or filled), optional `badge` count.
- The `badge` is `onDeep` 11pt bold on `badgeRed` (5.2:1) and shows nothing at 0. It is not read out, so the `label` says the number as well: "Notifications, 3 unread".
- Header icons sit 20pt apart; the close circle is the ranking flow's and the create-Bev wizard's dismiss.
- A press gives way a little (scale 0.98, opacity 0.7 over `fast`), like every tappable row and card.
