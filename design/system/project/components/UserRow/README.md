# UserRow

A person row for People (search, suggestions and the points ranking) and for followers lists.

- Provide: `user` ({ name, handle }), `meta` ("84 Bevs", "212 pts"), optional `rank` and `streak`, `following` to show the Follow/Following pill, `self` to highlight your own row in `primaryTint`.
- `context` adds a third line in `caption` with a 14pt `users` icon: "Followed by Sam and Arjun", so following a suggested person is a decision with something behind it. The row is 72pt with it, 64pt without.
- Pin your own row at the bottom of the ranking when it's off screen.
- The pill pops when it is toggled, like the heart; the row itself gives way a little under a press.
