# The ticketing system: setup and operations

How the internal bug reporter is wired, what has to be configured outside this
repository, and what is still unverified. The workflow it serves is in
[`bug-workflow.md`](./bug-workflow.md).

> **Status.** The tracker is the founders' board, an in-house private tracker,
> since 2026-11-17. It is the only tracker: there is no fallback. The board
> client has run against a board on a developer's machine, end to end; it has
> **not** yet run from the deployed function.

## The tracker: the founders' board

The founders' board (its own repository, its own Supabase project) holds the
tickets next to the cards they came from. An agent picks a ticket up with the
same tools it uses for a card, and "which is worse" is the board's own order.
This repository holds exactly three things: a way to file from a phone, a
secure server-side path to the board (with a read-back of the caller's own
tickets and two writes: "verified on the device", and the reporter's own
ranking of their open tickets), and the instructions an agent needs to work
from a ticket number. The "engineering dashboard" is the board.

`supabase/functions/bug-report/board.ts` talks to the board's intake endpoint
(`<board>/api/intake/…`). A ticket's name is whatever the board returns: `T-19`
was the first real one, and it opens at `<board>/?open=T-<n>`. A ticket moves
through New, Ready, In progress, In review and Done, and can also be closed
without a fix (a duplicate, dismissed, or turned into an idea). The ticket's
order is the board's one shared order; pictures are sent as base64, three
megabytes each at most, and kept in the board's database.

The token is of a kind that can file tickets, read back where they stand, close
one and order them, and nothing else. Setup is under
[What has to be configured outside this repository](#what-has-to-be-configured-outside-this-repository).

**What a failure looks like.** The function logs `tracker=board code=…` and
answers `tracker_not_configured` (503: the two secrets are missing or
unusable) or `tracker_error` (502), the second with a short `code` behind it:
`board_unauthorized` (the token was revoked or mistyped), `board_not_set_up`
(the board's database step has not been run), `board_unreachable`,
`board_refused` (a rule of the board, such as its sixty-an-hour limit),
`board_invalid`, `board_too_large`, `board_error`. None carries anything the
reporter typed.

## History

Linear was the tracker from 2026-11-09 until 2026-11-17, and is gone. Its
eleven live tickets were carried over to the board on 2026-11-17. Ten kept
their numbers (`BEV-7` is `T-7`; they fall between `T-5` and `T-18`), and
`BEV-19`, filed that morning, became `T-20`. Linear's sample issues, the test
issues, and two that the board already held as a card and a to-do were not
carried over. The board still answers to the old `BEV-<n>` name for the eleven,
which is the name this project's ledger holds, so Filed reports keeps listing
them with their state. A `BEV-<n>` in a branch name or PR title from before 2026-11-17 means one
of those Linear issues. Since 2026-11-17, `BEV-<n>` is also what the board calls
its cards (they were `FB-<n>`, which still works). Filing a report by Slack went
through Linear and no longer exists; there is no Slack-to-board path yet.

## The pieces

```
app/src/features/bug-report/      the reporter: the report button and the note (ReportButton, ReportNote),
         │                        the engine (pick, pickMode, capture, trail, infer, context),
         │                        the note's model and store, Filed reports and the rank sheet
app/src/app/_layout.tsx           mounts it, lazily, for an internal reporter only
         │  BeviApi.bugs.report() / listMine() / markVerified() / place()
         ▼
packages/api/src/bugs.ts          uploads up to 3 screenshots to a PRIVATE bucket,
         │                        then invokes the function with the user's JWT
         ▼
supabase/functions/bug-report/    POST  /bug-report         validate → redact → claim → board → record
         │                        GET   /bug-report/status  the caller's tickets with live state and rank
         │                        POST  /bug-report/verify  one ticket to Done
         │                        POST  /bug-report/place   one open ticket to a place in the caller's ranked list
         │   index.ts   the request flow and the four routes
         │   routes.ts  routing and the place route's body (pure, so the tests can import it)
         │   redact.ts  credential/PII stripping, input caps, the environment, breadcrumb and target allow-lists
         │   issue.ts   kind and severity, the issue title and the template body
         │   rank.ts    the ranked list: order, the position to write, respacing, the priority bands
         │   board.ts   the founders' board as the tracker: ticket, file, status, verify, place; the write-up the board shows
         ▼
the founders' board               the ticket, its name (`T-<n>`), its lifecycle
```

The database half is one migration,
`supabase/migrations/20261109000300_bug_reports.sql`:

| Object | What it is for |
|---|---|
| `profiles.role` now allows `tester` | A non-admin internal role. |
| `is_internal_reporter()` | `role in ('admin','tester')`. |
| `can_report_bugs()` | What the client asks to decide whether to show the entry points, and what the status and verify routes check. |
| `bug_reports` | The submission ledger: one row per idempotency key with the kind, severity and title as filed, the evidence paths (at most 3) and the identifier the tracker returned. **Not** a mirror of the board's mutable state. |
| `claim_bug_report(key, kind, severity, title, paths)` | Called **as the caller**. Authorises, rate-limits (20/hour), validates, and claims the idempotency slot. This is the real access check. |
| `finish_bug_report()` | Called **as the service role**, and revoked from `authenticated`: a client can never write a ticket identifier. |
| `forget_bug_evidence(paths)` | Bookkeeping for the retention sweep; removes only the paths it is handed. |
| `set_profile_role(handle, role)` | The operator's way to hand out `tester` or `admin` (below). Service role only. |
| `bug-evidence` bucket | **Private**, 10 MB, images only, insert-only, internal reporters' own folders. |

## Security, in one place

- **Authorisation is in Postgres, not in the client.** Hiding the button is
  cosmetic. `claim_bug_report()` raises `BEVI_UNAUTHORIZED` for anyone whose
  role is not `admin` or `tester`, and it runs on every submission; the status,
  verify and place routes call `can_report_bugs()` the same way, and read the
  ledger **as the caller** with an explicit `reporter_id` filter as well: the
  select policy also admits an admin, and an admin's own tickets are still the
  only ones Filed reports lists, `verify` moves or `place` ranks.
  `verify_jwt = true` on the function is only an outer gate — the publishable
  key ships in every copy of the app, so it proves nothing about *who* is
  calling.
- **The tracker credential never leaves the server.** `BOARD_INTAKE_TOKEN` is
  read from the Edge Function's environment. It is not in the client bundle,
  not in a response, and not in any log line this code writes.
- **Evidence is private.** The bucket has no public flag and no read policy.
  The function reads each object with the service role, sends the bytes to the
  board with the ticket, and deletes the staged objects if the ticket is never
  created. No signed URL is ever minted for the app.
- **Redaction runs server-side, on everything.** `redact.ts` strips bearer
  tokens, JWTs, Supabase/GitHub/Stripe/Slack/AWS key shapes, email
  addresses, URLs carrying a credential, and invisible/bidi characters — from
  the reporter's own typing, the automatic context, every breadcrumb, every
  pointed-at component and every screenshot caption, because pasting an error
  message is exactly how a token reaches a ticket.
- **Diagnostics are an allow-list.** `cleanEnvironment()` keeps seventeen
  named keys (the concrete `path` is dropped outright if it carries a query
  string or a fragment, or is not an absolute path; `pixelRatio` must be a
  finite number and `reducedMotion` a boolean). `cleanBreadcrumbs()` keeps the
  most recent 40 entries of four kinds with fixed fields: `nav` (route
  pattern), `api` (method name, error code, status, duration), `tap` (what was
  tapped, at most 120 characters; the app sends taps only while the reporter
  is recording steps) and `error` (an uncaught error's message, at most 200).
  `cleanSteps()` keeps at most 30 steps of 300 characters, which is what an
  explicit recording can hold. `cleanTargets()` keeps at most 6 pointed-at components: the
  component name and each ancestry name must be plain identifiers (a target
  whose name is not is dropped whole), the source file must be a `.ts`/`.tsx`/
  `.js`/`.jsx` path under `app/`, `packages/` or `shared/` with no `..`, at most
  12 props (strings, numbers, booleans) and 12 styles with identifier keys, a
  rect of four bounded numbers, a screenshot index 0–2 and a mark 1–9. A prop
  or style whose key could carry a credential or typed text (it matches
  `pass|secret|token|auth|cookie|key|pin|otp|code|email|phone|value|text|query|search|note|message|draft|bio`,
  case-insensitive) is dropped whatever its value, and when the body is built
  each `key=value` pair goes through `redact()` once more and is dropped if
  redaction would change it, because the secret-assignment patterns only see
  key and value together there. The concrete `path` is also dropped when it
  starts with `//` or has a segment of 24 or more `[A-Za-z0-9_-]` characters
  that is not a UUID (a reset token or a magic-link code; Bev ids are UUIDs and
  are kept). The request body is capped at 128 KB (131,072 bytes). With every
  field at these caps the largest body the app sends is 54,537 bytes in plain
  ASCII (about 27 KB of it the six targets) and about 94 KB when the free text
  is all two-byte UTF-8; a body over the cap is refused with 413
  (`payload_too_large`).
  `cleanCaptions()` keeps one 120-character caption per screenshot. Everything
  else the client sent is dropped, so a future client cannot widen what is
  collected without a server change.
- **Ticket text is data.** `neutralise()` defuses fences, headings and rules so
  reporter text cannot restructure the issue body, and the body opens with a
  line saying so. Values the body prints inside a code span (component names,
  source files, props) have their backticks removed, so none can close the
  span early. A target's label, text and role and every screenshot caption
  have `[`, `]`, `<`, `>`, a `!` before `[` and any backslash escaped, and a
  trailing backslash stripped, so none can render as a link or a remote image.
  Tap targets and error messages are printed only inside the Recent activity
  code fence, where markdown is not rendered, so they are not escaped. `AGENTS.md` tells agents the same thing in the same words.
- **One draft is one ticket.** The idempotency key is per draft, not per
  attempt. A replay returns the ticket that already exists; a concurrent
  attempt gets 409 rather than a second issue. The write that records the
  ticket on the ledger is tried twice and, if it still fails, logged with its
  status code (never the body): a row left `pending` after a created issue is
  the one way a later retry could file a duplicate, so that log line is loud.
- **No phantom tickets.** The identifier and URL come from the board's response.
  If the tracker does not confirm the ticket, the client raises instead of
  showing an ID. The same for Filed reports: a row the ledger does not hold is
  never shown, and a row the board cannot describe is shown as "unknown".
- **The place route's not-found says which kind it is, to the owner only.**
  A ticket that is not in the caller's ledger answers
  `{ "error": "not_found", "route": "place" }`, whoever owns it. Only once
  both tickets have passed the ledger check (both are the caller's) does a
  ticket that is in review, closed, of unknown state or without a manual
  order answer `{ "error": "not_found", "route": "place", "reason": "not_open" }`,
  which the client turns into a `conflict`. Neither reveals anything about
  another reporter's tickets.
- **Two writes after create, both to the caller's own tickets.**
  `markVerified` closes a ticket as Done, and `place` writes one open ticket's
  place in the board's order and the priority its new position implies: the top
  quarter of the caller's open tickets High, the middle half Medium, the rest
  Low, and an Urgent ticket stays Urgent. Both act only on a ticket the
  caller's own ledger holds; `place` also requires both tickets to be open (not
  in review and not closed) as the board reports them at that moment, read
  fresh rather than from the status cache. Nothing else in the app changes a
  ticket.
- **The browser is a first-class caller.** This is the first function the app
  invokes directly, so `cors.ts` answers the `OPTIONS` preflight before any
  auth check (the browser sends it without a JWT) and every response carries
  `Access-Control-Allow-Origin`. The origin is `*` on purpose: nothing here
  authorises by origin, the JWT is the credential and Postgres is the gate, and
  no cookies are involved. Without this the app only ever saw a network error,
  which is how the first live submission on 2026-11-09 failed.
- **Logs name the outcome, never the payload.** Each line carries a six-byte
  SHA-256 prefix of the idempotency key, the ticket identifier, and a provider
  error code; a created ticket's line adds the number of targets and the steps
  source, and a placement's line the new index, the priority and how many
  tickets were respaced. Never a title, a body or a target's contents.

### 1. The board

On the board, **Connect a CLI → The Bevi app**: each founder saves their Bevi
handle, and one makes the app's token. The board shows the token once. The
token is of a kind that can file tickets, read back where they stand, close one
and order them, and nothing else.

### 2. Supabase secrets

Set two secrets on the **app's** Supabase project, then deploy the function.
Always pass `--project-ref` for the app's project explicitly. The board has its
own Supabase project in the same organisation, and a command without the ref
can land on the wrong one (this happened once).

```bash
npx supabase secrets set --project-ref <the app's project ref> \
  BOARD_INTAKE_URL=https://<the board> BOARD_INTAKE_TOKEN=<shown once on the board>
npx supabase functions deploy bug-report --project-ref <the app's project ref>
```

| Variable | Required | What it does |
|---|---|---|
| `BOARD_INTAKE_URL` | yes | The board's address. `readBoardConfig` refuses one that is not `https` (or this machine), so the token is never sent in the clear. |
| `BOARD_INTAKE_TOKEN` | yes | The app's token. Server-only: it lives in the board's screen for a moment and in this project's secrets, never in a file, a log line or a response. |

If either is missing or unusable, filing fails with `tracker_not_configured`;
nothing is rerouted. The function says so once per cold start in its log,
without the values.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into Edge Functions automatically; do not set them by hand.

Locally, the same values go in `supabase/.env` (gitignored).

### 3. Deploy

```bash
supabase db push --project-ref <the app's project ref>   # 20261109000300_bug_reports.sql
supabase functions deploy bug-report --project-ref <the app's project ref>
```

Note that `supabase secrets set` is separate from deploying: deploying the
function does not carry the secrets with it.


### 4. The MCP connection, for coding agents

Agents pick a ticket up through the `bevi-board` MCP server, set up from the
board's **Connect a CLI** screen (in Claude Code, `/bevi:work T-104`). Until
that connection has actually been made on the machine in question, an agent
cannot read a ticket, and should say so rather than guessing at its contents.
The ticket workflow itself is in [`AGENTS.md`](../AGENTS.md) and
[`ticket-prompt.md`](./ticket-prompt.md).

### Granting the tester role

Only an admin can change `profiles.role` from a client, and the
`protect_profile_columns` trigger raises `BEVI_UNAUTHORIZED` for anyone else.
Studio's SQL editor has no `auth.uid()`, so a plain `update` there can never
pass that trigger either — which is why the migration ships an operator
function. From the SQL editor (which runs as the owner), or with the
service-role key:

```sql
select public.set_profile_role('their_handle', 'tester');
```

`'admin'` also makes someone an internal reporter and adds moderation powers;
`'user'` takes the access away. The function is revoked from `authenticated`,
so no signed-in user can call it for themselves. There is no UI for this, on
purpose: it is a rare, deliberate act.

## How the form's fields reach the board

| In the form | On the ticket |
|---|---|
| **What is it?** Bug / Fix suggestion / Idea / Design nit | The ticket's type on the board, and a `**Type:**` line under the opening quote |
| **How bad is it?** Blocker / Bad / Annoying / Polish | The ticket's priority, and a `**Severity:**` line |
| What went wrong? | The title |
| Describe the problem, steps, expected, actual | Their sections |
| Automatically included | The Environment section |
| The components pointed at (up to 6) | The **Pointed at** section, directly after Summary: one numbered block per component (its mark, else its position) with the source file, ancestry, role and label, text, props, how it was drawn, where it sat on screen, and which screenshot and mark show it. Only lines with data are printed; with none, the section says the note is about the whole screen. |
| Steps from a recording (**Record steps** … stop; `stepsSource: 'recorded'`, up to 30) | The same numbered list, under the line `_Recorded by the app while the reporter reproduced it, not typed by them._` |
| The app's recent activity trail | The Recent activity section, a fenced block of one line per entry: `nav`, `api`, `error` (the message), and `tap` (what was tapped, only during a recording) |
| Screenshots (up to 3), each with an optional caption | Pictures on the ticket, sent to the board as base64 (three megabytes each at most) and numbered by their place in the list (the number a pointed-at component's "Screenshot N" refers to). A caption becomes the picture's alt text and an italic line under it. |
| The "which is worse?" placement after filing | The ticket's place in the board's one shared order (the function says after or before which of the caller's tickets) and its priority, by the bands above; Filed reports reads the rank back from the board, so a reorder on the board moves it there too |

A founder may change the priority or the type on the board; the board's values
are the truth from then on, and Filed reports shows the board's state. A later
placement from the app does set the priority again from the new position,
except on an Urgent ticket.

## Retention

```bash
npm run bugs:purge-evidence                 # delete evidence older than 90 days
npm run bugs:purge-evidence -- --days 30
npm run bugs:purge-evidence -- --dry-run
```

It deletes the objects through the Storage API, then clears the paths through
`forget_bug_evidence()`, which removes only the paths it is handed from each
row's array. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
`supabase/.env`. Run it from a scheduled job once there is enough traffic for
it to matter; there is no cron for it yet, and this document should not
pretend otherwise.

## Tests, and what they do and do not cover

| Suite | Covers |
|---|---|
| `supabase/functions/bug-report/test.ts` (Deno) | Redaction; the environment allow-list (including the dropped query-string, `//` and opaque-segment paths with a UUID segment kept, and the typed pixel ratio and reduced-motion values), the 30-step cap, the breadcrumb allow-list (tap and error entries, the 40 cap) and the target allow-list (bad component names, `..` in a file, the 12-entry prop cap, props and styles with sensitive keys dropped, a `key=value` pair redaction catches dropped, ordinary props kept, range checks, the 6-target cap), captions, and link/image escaping in labels, text, roles and captions (including a trailing backslash); kind/severity and path validation; the ticket's write-up as the board receives it (the type line, the exact Pointed at markdown for a full target, a sparse one and none, backticks that cannot close a code span, the recorded-steps line, recent activity, the note on each picture); every function in `rank.ts` (top, bottom, middle, alone, the bands, Urgent kept); `routeOf` and the place route's body; the priority mapping, the board client's error mapping, that no Linear setting is read any more, the file, status, verify and place requests; the reporter-scoped ledger query and the retried ledger write — all against an injected `fetch`. The place route's handler itself (`handlePlace` in `index.ts`) is not exercised: index.ts starts a server when imported. |
| `supabase/tests/28_bug_reports.test.sql` (pgTAP, 65 assertions) | The `tester` role and `set_profile_role` (the trigger still refuses a plain update, even from the owner; `authenticated` cannot call it; the bypass flag is reset), the grants (notably that `authenticated` cannot call `finish_bug_report`), the RLS shape, the private bucket and its policy, the authorisation refusal, kind/severity/title/path validation (an over-long title included), the idempotency ledger's cases (in-flight, stale-pending re-arm keeping staged evidence, failed re-arm taking the retry's list), cross-reporter reads returning nothing, the 20-an-hour rate limit, and `forget_bug_evidence`. |
| `packages/api/test/bugs.test.ts` (vitest, 33 cases) | That nothing is uploaded or invoked before the input validates, that every screenshot goes to the private bucket in order and the function gets only paths (and one caption per path), that targets (the first six) and the steps source are sent, and a thirty-step recording as it is, that no credential is in the request body, the error-code mapping, `listMine` over the status route (including `rank`), `markVerified` over the verify route, `place` over the place route (validation, its own not-found, its `not_open` as a conflict, a bare 404 from a server that predates ranking, tracker failures), and the refusal of a response with no confirmed ticket. |
| `packages/conformance/src/index.ts` against the FakeApi (jest) | The bugs refusals for an ordinary and a signed-out account, and, with an internal reporter, `rank` on `listMine` (a new ticket at the top), `place` to the top and below another ticket with the new ranks and priorities, Urgent kept, and its validation, not-found (another reporter's ticket, an unknown one) and conflict (`reason: 'not_open'`, a closed ticket of the caller's) cases; and that `report` accepts more than six targets (the first six are kept) and a thirty-step recording. |
| `app/src/features/bug-report/__tests__/` (jest) | The report button's gating (hidden for an ordinary account, shown on tab and full-screen routes, never captures on press, filled while a note exists); the note: the type dropdown, Select element through select mode to a marked picture with the component and its source file, Capture screen, the Add photos menu and the three-picture limit, Record steps to Stop and the steps sent as recorded, send in the background, a failed send restored with the same key, set aside and discard; the pure model and the report it builds (targets, captions, `evidenceIndex`); picking a component from fibers with an allowlist of props and no typed text; select mode swallowing taps but not scrolls; the trail and explicit step recording; the inferred type; the context allow-list; the draft's persistence, its owner and the wipe on sign-out; Filed reports and the rank sheet against the FakeApi's `place`; and that the generated component manifest is current. |

**Not covered, honestly:** the live round trip from the deployed function to
the founders' board. The board client has run against a board on a developer's
machine, end to end, and its shapes are asserted against an injected `fetch`;
that is not the same as having watched the deployed function file a ticket.
The `place` route, the rank read on the status route and the ordering of a new
ticket on the board's shared order are only as verified as that. The first real
submission from the deployed function is a manual test, and it should be treated
as one: see the end-to-end checklist in [`bug-workflow.md`](./bug-workflow.md).

## Deliberate omissions

- **No console capture.** The breadcrumb trail is navigations, failed API
  calls (method name, code, status, duration), taps (the component and its
  label, only while the reporter is recording steps) and uncaught errors (the message only, redacted and capped at 200
  characters; never a stack or arguments). Captured `console.error` output is
  the easiest way to leak user content into a ticket, and nothing has needed
  it yet.
- **No duplicate detection, aging metrics or auto-triage.** The board has
  search; the rest is premature before there is history to measure.
- **No error-monitoring correlation.** There is no Sentry (or equivalent) in
  this repository to correlate with. When there is, the correlation ID belongs
  in the environment allow-list in `redact.ts` and `context.ts`.
