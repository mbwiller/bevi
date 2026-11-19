# Reporting, sorting and verifying a bug

The short version: **find it on your phone → file it in seconds → say what it
is on the founders' board → hand its number to a coding session → review the
PR → check it on the device → close it.**

The founders' board (`bevi-founders-board`, a separate private repository and
Supabase project) is the system of record: a report filed here becomes a
ticket there, named `T-<number>`. This repository holds the reporter, the
secure endpoint behind it and the agent instructions, not a second issue
database. Setup, secrets and operational notes are in
[`ticketing-system.md`](./ticketing-system.md), which also records that Linear
was the tracker until 2026-11-17.

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

The note is as tall as it needs to be, up to 60% of the screen (480pt on a short one). While the
keyboard is up it may use all the room above the keyboard instead, and it drops
the "sent with it" line and the report button so the text field has that room
(the chevron sets the note aside meanwhile). The text field starts at three
lines, grows as you type, and scrolls inside itself once the note is as tall as
it can be. Pictures and steps sit above it in an area that scrolls on its own,
so they never push the field out of view.

In the note:

| Control | What it does |
|---|---|
| **Type** | A small dropdown: Bug, Fix suggestion, Idea or Design nit. It starts on the type your sentence suggests and stays there until you pick one. Becomes the ticket's type on the board and its `Type` line. |
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
the next one; a small "Filed T-104" appears when the board has confirmed it,
with the real identifier. The ticket lands in **New**.

If it fails, a red dot appears on the button and pressing it brings the note
back with everything in it and a **Try again**. The retry reuses the same
submission key, so one note can only ever become one ticket, however many
times you press it.

There is no "How bad is it?" any more. Every report is filed at Medium, and
**where you rank it** sets the priority: "Place it" on the filed message, or
**Filed reports** (the list icon in the note, or Settings → Internal → Filed
reports), asks "Which is worse?" against your other open reports, using the
same placement the app uses to rank a Bev. The answer is written to the board as
the ticket's place in its order, and the priority follows from the position: the top
quarter of your open reports High, the middle half Medium, the rest Low. A
ticket someone marked Urgent on the board stays Urgent. Ranking needs the
`bug-report` function from this change to be deployed; against an older one
the app says so and the report is filed all the same.

## 2. Say what it is, on the board

A new ticket lands under **New** on the board's Tickets page, and on **Now**
for both founders. Open it: what the reporter wrote, the pictures, the element
they selected and its source file, the recorded steps and the device are all
there. Then one of four things:

| Action | What happens |
|---|---|
| **Accept** | It joins the end of **Ready**, the one list both founders share, worst first. |
| **Duplicate** | It is closed as a duplicate and leaves the lists. Never "fixed". |
| **Dismiss** | It is closed without a fix: cannot reproduce, or not something to do. |
| **Make it an idea** | It was really a feature. It becomes a card in Ideas and the ticket is closed pointing at it. |

Ready is ordered, not prioritised by hand. The reporter's "which is worse?" in
the app writes that order (see [Where the ranking lives](#where-the-ranking-lives)),
and either founder can move a ticket up or down on the board. A report with no
steps and no picture is not automatically bad: it is a starting point, and the
reporter still has the screen in their head. Add a note on the ticket asking
for what is missing; the next session that picks it up reads it.

## 3. Fix it, from the number alone

On the board, a Ready ticket's **Copy for CLI** gives the line to paste into a
fresh Claude Code or Codex session at the repository root (`Work on T-104 from
the Bevi founders board.`, or `/bevi:work T-104` in Claude Code); "Copy the top
3 for an agent" gives the same for the three worst. Nothing else: the point of
the workflow is that the ticket carries enough to start from zero.
[`ticket-prompt.md`](./ticket-prompt.md) is the longer form of the same request.

The agent picks the ticket up through the board's MCP server (`bevi-board`),
which moves it to **In progress** and hands over the report, the pictures and
what to do next. It reads `AGENTS.md` and the lane file, reproduces, fixes,
tests, and opens a PR with the ticket number in the branch and the title. It
keeps a short checklist on the ticket, each item with how to check it.

The agent may submit the ticket for review, which moves it to **In review**.
It may not move it to **Done**, and the board refuses if it tries: see below.

## 4. Verify it, on the device

`In Review` means "a human should look at this", in both senses: review the
code, and re-run the original report on the device and environment it came
from.

Only then, **Done**. The reporter can do that from the phone: **Settings →
Internal → Filed reports** lists your own tickets with their live state on the
board, and a ticket in review carries a **Verified on device** action that
moves it to Done through the function (`bugs.markVerified`, one of the two
writes the app ever makes to a ticket, and only to a ticket your own ledger
holds; the other is the ranking below). The board works just as well: the
ticket waits under **Waiting on your check** on Now, for whoever filed it, with
"Works on my phone, close it" and "Still broken", which sends it back to Ready.

This is the one rule the whole workflow is built around, so it is worth being
blunt about why. Almost everything reported from a phone is visual, or
timing-dependent, or specific to one browser's idea of a safe area. A passing
test suite says the thing the engineer modelled is now correct. It does not say
the thing the reporter saw has stopped happening. Merging is evidence of
readiness; only looking is evidence of a fix.

Closed without a fix is the other way out: a duplicate, dismissed, or made
into an idea. It always carries which, and it is never used as a quiet Done.
The app shows such a ticket as canceled, with the board's reason.

---

## The states

```
New ──▶ Ready ──▶ In progress ──▶ In review ──▶ Done
 │                                   │
 └───────────────┬───────────────────┘
                 ▼
     closed without a fix   (duplicate / dismissed / made into an idea)
```

| State | Means | In the contract (`BugTicketState`) |
|---|---|---|
| **New** | Just filed. Nobody has looked yet. Every submission starts here. | `triage` |
| **Ready** | Accepted, in the order to fix them. | `todo` |
| **In progress** | Someone (or some agent) is on it. | `in_progress` |
| **In review** | The fix exists and is waiting for whoever filed it to try it. | `in_review` |
| **Done** | A human confirmed the original report no longer reproduces. | `done` |
| **Closed without a fix** | A duplicate, dismissed, or made into an idea. Not a synonym for fixed. | `canceled` |

The contract's names (`BugTicketState`) are from when Linear was the tracker;
the function translates them to the board's stages.

## Where the ranking lives

There is one order for every open ticket on the board, shared by both
founders. After filing, the app asks "which is worse?" and "Place it" tells the
board which of your own tickets the new one comes after (or, for the top of
your list, which one it now comes before), through `POST /bug-report/place`
(`bugs.place`). The board fits it into the shared order; it rewrites its order
itself, so there is no gap to run out of. There is no table for this in the
database. The position in your own list of open tickets also sets the priority:

| Position among the reporter's open tickets | Priority written |
|---|---|
| Top quarter | High (2) |
| Middle half | Medium (3) |
| Bottom quarter | Low (4) |
| Any position, ticket already Urgent | Urgent (1), unchanged |

The position is measured at the middle of the ticket's slot, so a reporter
with one open ticket gets Medium, and with two, High then Medium. Filed reports
reads the rank back from the board, so reordering tickets on the board changes
the rank the app shows. A ticket in review, done, closed or of unknown state has
no rank and cannot be placed.

The server reads the reporter's tickets fresh from the board for every
placement. None of this has run from the deployed function yet; see the honest
list in [`ticketing-system.md`](./ticketing-system.md#tests-and-what-they-do-and-do-not-cover).

## Becoming an internal reporter

`profiles.role` has to be `admin` or `tester`. An operator grants it with
`select public.set_profile_role('<handle>', 'tester');` in Studio — the plain
`update` cannot pass the profile trigger there — see
[`ticketing-system.md`](./ticketing-system.md#granting-the-tester-role).

## What happens to the screenshots

They go into a **private** Supabase bucket (`bug-evidence`), which has no public
URL and no read policy at all. The Edge Function reads each object with the
service role, sends it to the board so the ticket carries its own copy, and
deletes the staged objects if the issue is never created. Whatever survives that
is swept by `npm run bugs:purge-evidence` (90 days by default).
