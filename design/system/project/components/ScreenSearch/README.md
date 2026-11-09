# ScreenSearch

Search tab (TASKS.md decision 32, M-16): wordmark Header with the close circle, the outlined SearchBar "Search a Bev or a person", a "Snap it" Pill, then the live map of New York City filling the rest of the screen. The preview shows it inline (left) and full screen (right).

- **Inline:** the map pans and zooms in place, with the MapFilterRow on top and the MapControls corner (open the full map, `View List`). Venue pins are MapCallouts.
- **Full screen:** tapping a pin, `View List` or "open the full map" opens the same map over the whole screen with the full chrome: `List | Map`, the close button, the filters, locate and `View List`; a tapped pin docks its VenueSheet below. The close button or Escape returns to the inline map where it was. Focus stays inside while it is open.
- One Google map per visit to the app: inline and full screen borrow the same map, so its viewport carries across, and leaving the tab never reloads it.
- The map area stays mounted while the results panel covers it, and it takes no gestures while the panel is up.
- Without a Google key in the build (and only then) the area is the placeholder: the `map` icon, "Map coming soon" and one line on what will show there. If Google fails to load or rejects the key: "Map unavailable right now". Never Google's grey box.
