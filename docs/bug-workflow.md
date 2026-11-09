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
`admin` or `tester`; everyone else never sees an entry point, and the server
refuses a submission from anyone else even if they call the endpoint directly.

Two ways in, both leading to the same full-screen form:

- the **Report a bug** pill in the bottom-left of any screen except the
  full-screen flows (ranking, creating a Bev, the photo viewer), whose
  bottom-left corner holds their own controls. Use this one: it keeps the
  screen you were on and records its route on the ticket.
- **Settings → Internal → Report a bug**, for when you look there first.

In the form:

| Field | Required | Notes |
|---|---|---|
| What is it? | yes, preset to **Bug** | Bug, Fix suggestion, Idea or Design nit. Becomes the Linear label of the same name and the ticket's `Type` line. |
| How bad is it? | yes, preset to **Annoying** | **Blocker**: cannot use the app, or data is wrong. **Bad**: a core flow is broken. **Annoying**: works, with a workaround. **Polish**: cosmetic. Becomes Linear's priority (Urgent, High, Medium, Low) and the ticket's `Severity` line. |
| What went wrong? | yes | The observable symptom. This becomes the ticket title. |
| Describe the problem | no | What you did, and what happened instead. |
| Steps to reproduce | no | One per line; pasted numbering is stripped. |
| Screenshot | no | Picked from the library or the camera, up to three. Resized and re-encoded to JPEG, which also strips EXIF/GPS. |

**Automatically included** expands to show exactly what is attached without you
typing it: the screen's route, the platform and browser family, the OS family,
the app version and build, the environment, the theme, whether you were online,
the viewport and the time. That list is an allow-list in
`app/src/features/bug-report/context.ts` — no account details, no page
contents, no headers, no tokens, and never the raw URL (which can carry a
token in its fragment). The server accepts one more thing, a short **recent
activity** trail: the last 20 screens you moved between (route patterns, never
ids) and API calls that failed (the method name, the error code, the status,
how long it took), which the app sends once its next release records them.
Nothing you typed, and nothing the server answered, is ever in that trail.

Press **Submit bug report**. Nothing leaves the device before that press: the
screenshot is held in memory until you submit.

On success you get the real Linear identifier — `Created BEV-104` — with
**Open the ticket** and **Copy ticket ID**. The ticket lands in **Triage**.

If it fails, the typed draft is kept (for a day, in `localStorage`) and the
button becomes **Try again**. The retry reuses the same submission key, so one
draft can only ever become one ticket, however many times you press it. The
screenshot is deliberately *not* kept — a stored picture of whatever was on
your screen is not worth the convenience — so re-attach it if you had one.

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
Internal → My reports** lists your own tickets with their live Linear state,
and a ticket in review carries a **Verified on device** action that moves it
to Done through the function (`bugs.markVerified`, the one write the app ever
makes to a ticket, and only to a ticket your own ledger holds). Linear's own
UI works just as well.

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
