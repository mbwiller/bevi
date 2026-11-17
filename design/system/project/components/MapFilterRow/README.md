# MapFilterRow

The filters over the map, one row that scrolls sideways: `Filters N`, `Neighborhood ▾`, `Category ▾`, `Price ▾`, `Open now` and `Retailer ▾`.

- Provide: `count` (facets that are on, for "Filters N"), each facet's picked label (`neighborhood`, `category`, `price`, `retailer`; '' for nothing), `openNow`, `neighborhoods` (false leaves the Neighborhood pill out), and a handler per pill.
- `Filters N` is the FilterPill with its label; it opens one 90% Sheet with every filter and "Reset filters".
- Each ▾ pill opens a multi-select Sheet (a check per picked option, "Any …" at the top to clear it). Its label becomes what is picked: "Coffee", "Coffee +2", "$, $$", "Chains", "Chains, Craft". Picking nothing means no filter.
- `Open now` toggles on the spot. It keeps only venues whose hours we could read and that are open; "Hours unknown" venues drop out while it is on.
- A pill that is on takes the selected look of an outlined Pill and the FilterPill (`primaryTint`, `primary` rim and text).
- Category offers the categories the viewer can see (never the alcoholic three under 21). Neighborhood is left out while the vocabulary is empty.
- Pills keep their 44pt targets inside the row: it pads 7pt above and below.
- **Parked (2026-11-11).** The venue map left the app with the navigation redesign, and no screen composes this component. It stays in the design system, and its code stays in the app unmounted, so the map can come back.
