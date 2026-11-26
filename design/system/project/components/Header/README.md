# Header

The 44pt screen header: the wordmark or a 20pt bold title on the left, 28pt icons on the right; Lists centres a caps title instead.

- Provide: `wordmark` or `title`, `centered` for Lists ("LISTS"), `actions` ([{ icon, label, badge?, onClick, variant? }]), `onBack` for pushed screens (People, Notifications, Bev detail).
- A tab's own screen names itself with a plain title and has nothing to close: "Add a Bev", "Map".
- The Feed's header carries the bell, then Find people. The bell's `badge` is the unread count, and its label says the count too. No calendar.
