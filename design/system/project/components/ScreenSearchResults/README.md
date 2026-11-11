# ScreenSearchResults

Add Bev while typing: the same Header, bar and "Snap it", with the results under them and a ghost **Cancel** beside the bar.

- Typing (debounced 250ms): one query searches both, grouped under "BEVS" (BevRows with `showImage` and the rating count) and "PEOPLE" (UserRows with Follow); an empty group is left out, and nothing in either shows one empty state. A query that starts with "@" searches people only.
- A sticky "Can't find it? Add a new Bev" closes the screen's bottom and turns `primary` when no Bev matches. It always sits above the keyboard.
- Cancel clears the bar and drops the keyboard, back to Recents and Popular on Bevi.
- There is no map behind the results: they are the screen's body.
