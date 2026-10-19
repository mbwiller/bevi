# ScreenSearchResults

Search tab with the results panel up: focusing the bar slides the panel over the map area from under the bar (opacity and a short downward slide over `base`; under Reduce Motion it just appears), and a ghost **Cancel** joins the bar.

- Idle: Recents (the Bevs you opened) and "Suggested for you" (people). Typing (debounced 250ms): one query searches both, grouped under "BEVS" (BevRows with `showImage` and the rating count) and "PEOPLE" (UserRows with Follow); an empty group is left out, and nothing in either shows one empty state.
- A sticky "Can't find it? Add a new Bev" closes the panel's bottom and turns `primary` when no Bev matches. It always sits above the keyboard.
- Cancel (or clearing the bar, then Cancel) slides the panel away and leaves the map exactly where it was.
