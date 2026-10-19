# SearchBar

Search input in two forms: `filled` (grey 36pt bar at the top of Feed) and `outlined` (48pt field on the Search tab).

- Provide: `placeholder` that names what can be found ("Search a Bev or a person", "Search by name or @handle"), `value`/`onChange`, `id`, and `onFocus` where focusing opens something (the Search tab's results panel).
- A clear button appears once there is text. Debounce queries 250ms.
