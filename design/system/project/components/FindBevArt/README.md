# FindBevArt

The Map tab's art: a round minimap, dark until walked, with a lit path from you to the nearest Bev.

- Provide: `size` (224 on the Map tab), `title` (its spoken description).
- One picture, not a live map: the ground is `tasteCard` with faint `onDeep` streets, the walked path is lit in `onDeep` mixed with a little `primary`, the route and its destination are `primary`, and you are the `fizz` dot with a heading triangle. The ground and the lit path are the fixed-dark pair, so it reads the same in both themes.
- It stands for Bev Maps (Find Bev): tap once, and it walks you to the closest open place that sells drinks. Don't animate it, don't put a score on it, and don't use it anywhere but the Map tab.
