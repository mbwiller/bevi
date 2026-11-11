# TabBar

The five-tab bar: Feed, Lists, Add Bev (a raised `primary` circle with a plus), Map, Profile (the user's 32pt Avatar).

- Provide: `active` (`feed`, `lists`, `add`, `map`, `profile`), `user` (for the avatar), `onChange`, `safeArea` (adds the 34pt home-indicator inset).
- Icons are 28pt outlines in `text` (stroke 1.5); labels 10pt. The current tab turns `primary`: its icon (stroke 2) and its label (bold). On Profile the Avatar takes a `primary` ring instead (a 2pt `surface` gap, then 1.5pt `primary`).
- Add Bev is a 46pt `primary` circle with a 26pt plus in `onPrimary`. Its bottom edge lines up with the other icons' 32pt box, so it rises 14pt above them and crosses the bar's top hairline; a 4pt `surface` ring separates the two. No shadow and no blur: the ring is the whole effect.
- The bar paints above the screen's content, so nothing clips the raised circle.
