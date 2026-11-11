# BucketButton

Gut-check choice in the ranking flow: a `primary` ring filled to a level, over its label. Loved is full, fine is half, disliked is empty, so the order reads without colour.

- Provide: `bucket` (loved, fine, disliked), `selected`, `dimmed`, `onClick`. Always show all three, in that order, in one row of three equal columns on the 16pt gutter, under a centred "How was it?".
- Labels are fixed: "Loved it", "It was okay", "Not for me", in `body` at weight 600, centred under the ring. The label always shows.
- The ring is 76pt with a 2.5pt `primary` border and a 4pt gap to the fill. One colour only: no score colours, no faces, no gradient, no shadow, and nothing blurred behind the row. It sits on plain `surface`.
- Chosen: a 26pt check badge (`text` on a 3pt `surface` gap) at the ring's top right. Pass `dimmed` to the other two: the ring drops to 35% and the label goes `textSecondary`.
- Motion: the ring presses to 94% and the badge scales in over `fast` (150ms). Reduce Motion shows the badge at once.
- Don't add a fourth option, colour the rings by bucket, or tint the label.
