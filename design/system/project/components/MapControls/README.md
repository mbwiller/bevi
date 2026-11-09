# MapControls

The map's floating controls. Inline under the search bar: the filter row on top, and a round "open the full map" button over the `View List` pill at the bottom right. Full screen: `List | Map` with the close button on top, the filter row under them, and the round locate button over `View List`.

- Provide: `expanded`, `mode` (`map` or `list`) and `onModeChange`, `onExpand`, `onClose`, `onLocate`, `located` (the blue dot is up: the arrow turns `primary`), `locating`, `onViewList`, and the MapFilterRow as `children`.
- `List | Map` is a segmented control on a `primary` rim: the side that is on is filled `primary` with `onPrimary` text, the other reads `primary` on `surface`, as Beli fills its teal. No people button: friends' pins went with the venue step.
- `View List` is a 44pt filled `primary` pill. In list mode the corner buttons go; `List | Map` brings the map back.
- Tapping a pin, `View List` or "open the full map" opens the same map full screen; the close button (or Escape) returns to the inline map exactly where it was.
- Everything sits clear of Google's logo (bottom left), Google's terms (bottom right) and the OpenStreetMap credit above the logo: the corner stack starts 36pt up.
- Round buttons are 44pt `surface` circles with a hairline and `elevation-floating`, so they hold up over any tile. Locate asks for the position only when tapped, never on load, and it stays on the device.
