# SearchBar

Search input in two forms: `filled` (grey 36pt bar at the top of the Feed and of People) and `outlined` (48pt field on Add Bev).

- Provide: `placeholder` that names what can be found ("Search a Bev or a person", "Search people"), `value`/`onChange`, `id`, and `onFocus` where focusing changes the screen.
- A clear button appears once there is text. Debounce queries 250ms.
