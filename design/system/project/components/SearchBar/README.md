# SearchBar

Search input in two forms: `filled` (grey 36pt bar at the top of Feed) and `outlined` (48pt field on the Add Bev tab).

- Provide: `placeholder` that names what can be found ("Search a Bev, brand or flavor", "Search by name or @handle"), `value`/`onChange`, `id`.
- A clear button appears once there is text. Debounce queries 250ms.
