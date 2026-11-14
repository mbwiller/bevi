# Reporting, triaging and verifying a bug

The short version: **find it on your phone → file it in seconds → triage it in
Linear → hand the ID to a fresh coding session → review the PR → check it on
the device → close it.**

Linear is the system of record. This repository holds the reporter, the secure
endpoint behind it and the agent instructions — not a second issue database.
Setup, secrets and operational notes are in
[`ticketing-system.md`](./ticketing-system.md).

---

## 1. Report it, from the phone

The reporter is **internal only**. You see it when your `profiles.role` is
`admin` or `tester`; everyone else never sees an entry point, never downloads
the reporter's code, and the server refuses a submission from anyone else even
if they call the endpoint directly.

The way in is the **report button**: a round button with a warning triangle at
the bottom right of every signed-in screen, the full-screen flows included
(ranking, creating a Bev, the photo viewer). Press it and a note opens along
the bottom of the screen; the app above it stays usable. Press it again and the
note is set aside, with a dot on the button and the triangle filled for as long
as a note exists. **Settings → Internal → Report a bug** opens the same note.

There is one note at a time. Setting it aside keeps it while you move around
the app, look at the thing again, and come back; its text survives a reload
(for a day, in `localStorage`), its pictures do not.

In the note:

| Control | What it does |
|---|---|
| **Type** | A small dropdown: Bug, Fix suggestion, Idea or Design nit. It starts on the type your sentence suggests and stays there until you pick one. Becomes the Linear label of the same name and the ticket's `Type` line. |
| **Select element** | The note steps aside and the next tap on the app **selects** what you tapped instead of pressing it (scrolling still works; Cancel or Escape backs out). The note then shows the component, its source file and a picture of the screen with it outlined and numbered, with **Wider** and **Narrower** to move up and down the component tree. Up to six selections. |
| **Capture screen** | A picture of the screen behind the note; the note is never in it. Each press adds one. |
| **Record steps** | Nothing is recorded unless you press this. The note closes, the report button becomes **Stop** with a live count, and every screen you open and every tap becomes a step (at most 30). Stop puts the steps in the note, where you can record again or remove them. Taps inside the reporter are never steps, and nothing you type is. |
| **Add photos** | A two-row menu: a screenshot of this screen (the same as Capture screen), or the photo library and camera. |
| **The text field** | The one thing you type: what is wrong, or what you want. Its first sentence becomes the ticket title, prefixed with what you selected. |

A report carries at most **three pictures**, screenshots and photos together
(the server, the bucket and the ledger all enforce it). A selection past the
limit is still recorded with its component details; it just has no picture.
Pictures are redrawn from the page, not photographed, so a map can come out
blank and a glass surface comes out as its flat tint. Photos are resized and
re-encoded to JPEG, which also strips EXIF/GPS.

The caption line under the field expands to show what goes with the note
without your typing it: the screen's route and path, the platform and browser
family, the OS family, the app version and build, the environment, the theme,
whether you were online, whether the app was opened from the home screen, the
viewport, pixel ratio and safe area, and the time. That list is an allow-list
in `app/src/features/bug-report/context.ts`, enforced again by the server — no
account details, no headers, no tokens, and never the raw URL with its query
string or fragment. A selected component adds its name, source file, label,
visible text, a short allow-list of presentational props, its size and
position, and the design tokens it was drawn with; never the contents of a
text field. The server also accepts a short **recent activity** trail, of
which it keeps the last 40 entries: the screens you moved between (route
patterns, never ids), API calls that failed (the method name, the error code,
the status, how long it took), uncaught errors (the message only, redacted and
capped at 200 characters), and taps (the component and its label) only while a
step recording is running. Nothing you typed, and nothing the server answered,
is ever in that trail.

Press **Send**. Nothing leaves the device before that press. The note closes
at once and the report files in the background, so you can carry on and write
the next one; a small "Filed BEV-104" appears when Linear has confirmed it,
with the real identifier. The ticket lands in **Triage**.

If it fails, a red dot appears on the button and pressing it brings the note
back with everything in it and a **Try again**. The retry reuses the same
submission key, so one note can only ever become one ticket, however many
times you press it.

There is no "How bad is it?" any more. Every report is filed at Medium, and
**where you rank it** sets the priority: "Place it" on the filed message, or
**Filed reports** (the list icon in the note, or Settings → Internal → Filed
reports), asks "Which is worse?" against your other open reports, using the
same placement the app uses to rank a Bev. The answer is written to Linear as
the issue's manual order, and the priority follows from the position: the top
quarter of your open reports High, the middle half Medium, the rest Low. A
ticket someone marked Urgent in Linear stays Urgent. Ranking needs the
`bug-report` function from this change to be deployed; against an older one
the app says so and the report is filed all the same.

## 2. Triage it, in Linear

Work the **Triage** view. For each new report:

1. Read it against the evidence. If the steps do not match the screenshot, ask
   in a comment rather than guessing.
2. Check for a duplicate. If it is one, link it and **Cancel** the new issue
   with the reason. Canceled is never "fixed".
3. Check the type label the reporter chose (`Bug`, `Fix suggestion`, `Idea`,
   `Design nit`) and add a component label: `Ratings`,
   `Profiles`, `Search`, `Discovery`, `Collections`, `Venues`, `Authentication`,
   `Navigation`, `Backend/API`, `Performance`, `Other`.
4. Check the priority. The reporter's **How bad is it?** set it on create;
   you have the whole board in view, which a phone form does not, so change
   it when the board says otherwise:

   | Reporter said | Priority on create | Means |
   |---|---|---|
   | Blocker | Urgent / P0 | Outage, data loss, a security problem, or the app is unusable |
   | Bad | High / P1 | A core workflow is broken |
   | Annoying | Medium / P2 | A real usability defect with a workaround |
   | Polish | Low / P3 | Cosmetic, or a small improvement |

   The reporter's own ranking can set it again later (see
   [Where the ranking lives](#where-the-ranking-lives)): a placement from the
   app rewrites the priority from the ticket's new position, except on an
   Urgent ticket. Mark something Urgent in Linear when it must stay at the top
   whatever the reporter's list says.

5. Write the acceptance criterion if the template's is not specific enough.
   "Rating still shows after a refresh on iOS Safari" beats "fix the bug".
6. Move it to **Todo**.

A report with no steps and no screenshot is not automatically bad — it is a
starting point. Ask for what is missing in a comment; the reporter still has
the screen in their head.

## 3. Fix it, from the ID alone

Open a brand-new session at the repository root and paste the prompt in
[`ticket-prompt.md`](./ticket-prompt.md). Nothing else: the point of the
workflow is that the ticket carries enough to start from zero.

The agent retrieves the ticket through the Linear MCP server, reads `AGENTS.md`
and the lane file, reproduces, fixes, tests and opens a PR with the ticket ID
in the branch and the title. Linear links the branch and the PR to the issue
once the GitHub integration is connected.

The agent may move the issue to **In Review**. It may not move it to **Done** —
see below.

## 4. Verify it, on the device

`In Review` means "a human should look at this", in both senses: review the
code, and re-run the original report on the device and environment it came
from.

Only then, **Done**. The reporter can do that from the phone: **Settings →
Internal → Filed reports** lists your own tickets with their live Linear state,
and a ticket in review carries a **Verified on device** action that moves it
to Done through the function (`bugs.markVerified`, one of the two writes the
app ever makes to a ticket, and only to a ticket your own ledger holds; the
other is the ranking below). Linear's own UI works just as well.

This is the one rule the whole workflow is built around, so it is worth being
blunt about why. Almost everything reported from a phone is visual, or
timing-dependent, or specific to one browser's idea of a safe area. A passing
test suite says the thing the engineer modelled is now correct. It does not say
the thing the reporter saw has stopped happening. Merging is evidence of
readiness; only looking is evidence of a fix.

`Canceled` is the other terminal state, for duplicate, cannot reproduce, or
won't fix. It always carries a reason, and it is never used as a quiet Done.

---

## The states

```
Triage ──▶ Todo ──▶ In Progress ──▶ In Review ──▶ Done
   │                                   │
   └───────────────┬───────────────────┘
                   ▼
               Canceled   (duplicate / cannot reproduce / won't fix)
```

| State | Means |
|---|---|
| **Triage** | New, unreviewed, no priority yet. Every submission starts here. |
| **Todo** | Described well enough to work on, prioritised, with an acceptance criterion. |
| **In Progress** | Someone (or some agent) is on it. |
| **In Review** | The fix exists and is awaiting code review *and* device verification. |
| **Done** | A human confirmed the original report no longer reproduces. |
| **Canceled** | Terminal, with a documented reason. Not a synonym for fixed. |

## Where the ranking lives

After filing, the app asks "which is worse?" and places the new ticket in the
reporter's own ranked list of open tickets (Triage, Todo, In Progress). There
is no table for this in the database. The position is written to Linear as the
issue's manual order (`sortOrder`, lower first) through
`POST /bug-report/place` (`bugs.place`), and the priority is set from where the
ticket landed:

| Position among the reporter's open tickets | Priority written |
|---|---|
| Top quarter | High (2) |
| Middle half | Medium (3) |
| Bottom quarter | Low (4) |
| Any position, ticket already Urgent | Urgent (1), unchanged |

The position is measured at the middle of the ticket's slot, so a reporter
with one open ticket gets Medium, and with two, High then Medium. Filed reports
reads the rank back from Linear's `sortOrder`, so dragging the issue in a
manually ordered Linear view changes the rank the app shows. A ticket in
review, done, canceled or of unknown state has no rank and cannot be placed.

The server reads the reporter's tickets fresh from Linear for every
placement, writes the midpoint between the two neighbours, and only when they
are too close to split rewrites the reporter's other open tickets to whole
steps first. None of this has run against the real Linear API yet; see the
honest list in [`ticketing-system.md`](./ticketing-system.md#tests-and-what-they-do-and-do-not-cover).

## Becoming an internal reporter

`profiles.role` has to be `admin` or `tester`. An operator grants it with
`select public.set_profile_role('<handle>', 'tester');` in Studio — the plain
`update` cannot pass the profile trigger there — see
[`ticketing-system.md`](./ticketing-system.md#granting-the-tester-role).

## What happens to the screenshots

They go into a **private** Supabase bucket (`bug-evidence`), which has no public
URL and no read policy at all. The Edge Function reads each object with the
service role, uploads it to Linear so the ticket carries its own copy, and
deletes the staged objects if the issue is never created. Whatever survives that
is swept by `npm run bugs:purge-evidence` (90 days by default).
