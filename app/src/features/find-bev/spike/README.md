# Find Bev spike (S1 / S2)

Temporary: delete this folder (and restore `app/(tabs)/map/index.tsx`) once the iPhone test is done.
It answers Phase 0 of `docs/find-bev-in-app-plan.md`: can the camera view live inside Bevi's shell on
a real iPhone? It finds no store and calls no backend, and position never leaves the phone.

**Where it is:** the Map tab, for internal bug reporters only (the accounts that see the Report a bug
header action). They get a small **Camera test** entry at the bottom of the tab; everyone else's Map
tab is unchanged.

Every result is in the on-screen log. **Copy log** after each run and paste it back.

## S1, at a desk: passed 2026-11-14

`expo export` compiles the CSS module; 19 of 19 checks pass in Chromium at iPhone size with a fake
camera (hashed classes, `composes`, backdrop-filter, the Modal portal outside `#root`, video playing,
×, Escape and history-back each ending the camera track). Findings for the real PRs:

- `browserslist` is required: without it the build drops `-webkit-backdrop-filter` and rewrites
  `@media (max-height: 500px)` to range syntax. With `iOS >= 16` both stay.
- A fresh checkout's `tsc` cannot see `*.module.css` (the types arrive through the gitignored
  `expo-env.d.ts`). Commit `/// <reference types="expo/types" />`, not a hand-written declaration.
- `@types/react-dom` is not installed; the island's tests need it (or a shim) for `react-dom/client`.
- jest needs a `moduleNameMapper` for `\.module\.css$` (`jest.cssModule.js`).
- The camera view's own jsdom suite (react-dom `createRoot` + `act`, 6 tests) passed locally but was
  dropped from #204: the app CI job's jest workers ran out of heap with it in (the Feed route suites
  already peak at about 3.3 GB). The real port's layer 5b needs that memory problem solved first.

## S2, on an iPhone: the checklist

Open the Map tab, tap **Camera test**. Run it four times if you can: Safari tab; your Home Screen
install (top inset reads 0 on a fresh one, about 62 on an old translucent one); the other install type
(for a translucent one, tap **Translucent install** in Safari, then Add to Home Screen); and one phone
below iOS 18. Light and dark each.

1. **Find Bev** → the location prompt appears on this tap. Log: `first fix after … ms`.
2. **Enable camera** → the motion prompt, then the camera prompt, from this one tap.
   Log: `motion permission: granted`, `camera: stream after … ms`. `denied` after a few ms with no
   prompt means the gesture was lost: that is a fail.
3. The camera plays full screen over the tab bar. Bottom pill: `… playing · 1 live`. The middle pill
   shows a heading that turns with you.
4. The minimap and the × are fully clear of the status bar and of iOS 26's top blur. Try all three
   **Camera view top edge** settings and note which looks right on each install type.
5. The glass pills blur the camera behind them (not flat grey).
6. × → back on the Map tab, the camera indicator (green dot) goes off.
   Log: `trip ended by ×: camera tracks still live = 0`.
7. Again, then swipe back from the left edge. The trip ends, indicator off. Log: `back navigation`
   or `tab blur`.
8. Again, then switch tabs (if the bar is reachable) or sign out mid-trip from another device.
   Indicator off.
9. Again, then lock the phone for 10 s and unlock; then go to the Home Screen for 30 s and return.
   The picture comes back (`camera recovered`, or still `playing`).
10. Deny the camera once (Settings → Safari → Camera, or a fresh install): the view opens dark,
    nothing crashes.

Pass: 1–3 and 6–9 hold on every install type, and at least one top-edge setting passes 4.
If 2 or 3 fails in the Home Screen app and cannot be fixed, stop: Plan B (section 8 of the plan).
