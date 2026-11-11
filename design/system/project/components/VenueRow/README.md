# VenueRow

A venue in the map's List view: its name, "Craft · Yorkville", "Open now · 3 Bevs", and the pin's score in a ScoreBubble (predicted when the pin's is).

- Provide: `venue`, `openNow`, `score`, `predicted`, `bevs`, `onClick` (switches to the map, centred on the venue, with its VenueSheet open).
- The list is the venues in view, in the order the map asked for them (best first). No score yet: no bubble.
- One button per row, its name read first.
- **Parked (2026-11-11).** The venue map left the app with the navigation redesign, and no screen composes this component. It stays in the design system, and its code stays in the app unmounted, so the map can come back.
