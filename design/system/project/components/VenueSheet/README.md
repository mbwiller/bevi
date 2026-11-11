# VenueSheet

The tapped venue, docked under the full-screen map: the map shrinks above it, so the raised pin, Google's logo and the OpenStreetMap credit stay in view, and the map keeps panning.

- Order: the name (`screenTitle`) with the close circle; "Craft · Yorkville · Manhattan"; the open state with `clock` ("Open now", "Closed", "Hours unknown"; never "closed" for hours we couldn't read); the address with `map-pin`; the website as a `primary` link (its host, opening in a new tab); then "Bevs here (N)" and a BevRow per Bev; last, "© OpenStreetMap contributors" as a caption.
- Each BevRow shows your score if you ranked the Bev (meta "Your score"), else your predicted score ("You'd rate it", dotted ring), else its Bayesian score with the rating count. Rank it and Want to Try as everywhere; tapping a row opens the Bev.
- Loading: the pin's name, kind and open state fill the header at once, "Bevs here (N)" uses the pin's count, and Skeleton rows hold the list.
- Gone since the pin was drawn (`not_found`): "This spot isn't here anymore". Any other failure: an ErrorState with Retry.
- About 40% of the screen; it scrolls inside. Closing it (the close circle, Escape, a tap on the map) clears the selection.
- **Parked (2026-11-11).** The venue map left the app with the navigation redesign, and no screen composes this component. It stays in the design system, and its code stays in the app unmounted, so the map can come back.
