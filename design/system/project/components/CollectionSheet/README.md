# CollectionSheet

"Your collection": a 90% Sheet with every category the viewer can see, in catalog order, each with its icon, "9 of 40" and the same 4pt bar.

- Provide: `rows` (`{ category, ranked, total }` from `stats.getCategoryProgress()`), `onSelect`, `onClose`. Categories with nothing in them are left out; the alcoholic three never reach an under-21 viewer.
- The sheet opens on the overall line ("37 of 378 tried · 9%"). Catalog order stays put as you rank, so a bar never jumps rows.
- Tapping a row scopes Bev'd to that category and closes the sheet.
