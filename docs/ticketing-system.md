# The ticketing system: setup and operations

How the internal bug reporter is wired, what has to be configured outside this
repository, and what is still unverified. The workflow it serves is in
[`bug-workflow.md`](./bug-workflow.md).

> **Status.** Everything in this repository is implemented and tested. The
> Linear side is **not configured yet**: no workspace, team, API key or MCP
> connection has been set up from here, and nothing below should be read as a
> claim that one exists. The function answers `tracker_not_configured` (503)
> until `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are set, and the app turns that
> into "The issue tracker is not configured yet".

## Why Linear, and not a dashboard in this repo

Linear owns issue identity, status, priority and discussion. Building a second
issue database here would mean two places that disagree about whether something
is fixed, plus a triage UI, a search, a permissions model and an audit trail —
all of which Linear already has, and none of which is this product.

So this repository holds exactly three things: a way to file from a phone, a
secure server-side path to Linear (with a read-back of the caller's own
tickets and two writes: "verified on the device", and the reporter's own
ranking of their open tickets), and the instructions an agent needs to work
from a ticket ID. The "engineering dashboard" is Linear's
own views (below).

## The pieces

```
app/src/features/bug-report/      the reporter (form, context, draft, launcher)
app/src/app/report-bug.tsx        its full-screen modal route
         │  BeviApi.bugs.report() / listMine() / markVerified() / place()
         ▼
packages/api/src/bugs.ts          uploads up to 3 screenshots to a PRIVATE bucket,
         │                        then invokes the function with the user's JWT
         ▼
supabase/functions/bug-report/    POST  /bug-report         validate → redact → claim → Linear → record
         │                        GET   /bug-report/status  the caller's tickets with live state and rank
         │                        POST  /bug-report/verify  one ticket to Done
         │                        POST  /bug-report/place   one open ticket to a place in the caller's ranked list
         │   index.ts   the request flow and the four routes
         │   routes.ts  routing and the place route's body (pure, so the tests can import it)
         │   redact.ts  credential/PII stripping, input caps, the environment, breadcrumb and target allow-lists
         │   issue.ts   kind and severity, the issue title and the template body
         │   rank.ts    the ranked list: order, the position to write, respacing, the priority bands
         │   linear.ts  the GraphQL client (fileUpload, issueCreate, states, labels, issues, issueUpdate)
         │   cors.ts    the preflight answer and the allow headers every response carries
         ▼
Linear                            the issue, its identifier, its lifecycle
```

The database half is one migration,
`supabase/migrations/20261109000300_bug_reports.sql`:

| Object | What it is for |
|---|---|
| `profiles.role` now allows `tester` | A non-admin internal role. |
| `is_internal_reporter()` | `role in ('admin','tester')`. |
| `can_report_bugs()` | What the client asks to decide whether to show the entry points, and what the status and verify routes check. |
| `bug_reports` | The submission ledger: one row per idempotency key with the kind, severity and title as filed, the evidence paths (at most 3) and the identifier Linear returned. **Not** a mirror of Linear's mutable state. |
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
  only ones My reports lists, `verify` moves or `place` ranks.
  `verify_jwt = true` on the function is only an outer gate — the publishable
  key ships in every copy of the app, so it proves nothing about *who* is
  calling.
- **The tracker credential never leaves the server.** `LINEAR_API_KEY` is read
  from the Edge Function's environment. It is not in the client bundle, not in
  a response, and not in any log line this code writes.
- **Evidence is private.** The bucket has no public flag and no read policy.
  The function reads each object with the service role, hands the bytes to
  Linear's own `fileUpload`, and deletes the staged objects if the issue is
  never created. No signed URL is ever minted for the app.
- **Redaction runs server-side, on everything.** `redact.ts` strips bearer
  tokens, JWTs, Supabase/Linear/GitHub/Stripe/Slack/AWS key shapes, email
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
  tapped, at most 120 characters) and `error` (an uncaught error's message, at
  most 200). `cleanTargets()` keeps at most 6 pointed-at components: the
  component name and each ancestry name must be plain identifiers (a target
  whose name is not is dropped whole), the source file must be a `.ts`/`.tsx`/
  `.js`/`.jsx` path under `app/`, `packages/` or `shared/` with no `..`, at most
  12 props (strings, numbers, booleans) and 12 styles with identifier keys, a
  rect of four bounded numbers, a screenshot index 0–2 and a mark 1–9.
  `cleanCaptions()` keeps one 120-character caption per screenshot. Everything
  else the client sent is dropped, so a future client cannot widen what is
  collected without a server change.
- **Ticket text is data.** `neutralise()` defuses fences, headings and rules so
  reporter text cannot restructure the issue body, and the body opens with a
  line saying so. Values the body prints inside a code span (component names,
  source files, props) have their backticks removed, so none can close the
  span early. `AGENTS.md` tells agents the same thing in the same words.
- **One draft is one ticket.** The idempotency key is per draft, not per
  attempt. A replay returns the ticket that already exists; a concurrent
  attempt gets 409 rather than a second issue. The write that records the
  ticket on the ledger is tried twice and, if it still fails, logged with its
  status code (never the body): a row left `pending` after a created issue is
  the one way a later retry could file a duplicate, so that log line is loud.
- **No phantom tickets.** The identifier and URL come from Linear's response.
  If the provider does not confirm the issue, the client raises instead of
  showing an ID. The same for My reports: a row the ledger does not hold is
  never shown, and a row Linear cannot describe is shown as "unknown".
- **Two writes after create, both to the caller's own tickets.**
  `markVerified` moves a ticket to Done, and `place` writes one open ticket's
  `sortOrder` (Linear's manual order) and the priority its new position
  implies: the top quarter of the caller's open tickets High, the middle half
  Medium, the rest Low, and an Urgent ticket stays Urgent. Both act only on a
  ticket the caller's own ledger holds; `place` also requires both tickets to
  be open (Triage, Todo or In Progress) as Linear reports them at that moment,
  read fresh rather than from the status cache. When the two neighbours are
  too close to split (less than 1e-6 apart), `place` first rewrites the
  `sortOrder` of the caller's other open tickets, one at a time (at most 50),
  then the moving one. Nothing else in the app changes a ticket.
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

## What has to be configured outside this repository

### 1. Linear

1. Create (or pick) a team whose issue prefix is `BEV`, so identifiers read
   `BEV-104`. Turn **Triage** on for it.
2. Make sure the four labels the reporter's **Type** maps to exist, spelled
   exactly: `Bug`, `Fix suggestion`, `Idea`, `Design nit`. Workspace-level or
   team-level both work (Linear's default `Bug` is workspace-wide; the function
   asks `issueLabels` by name and prefers the team's own when both exist); a
   missing one is logged and the ticket is filed without it. Component labels (`Ratings`, `Profiles`, `Search`,
   `Discovery`, `Collections`, `Venues`, `Authentication`, `Navigation`,
   `Backend/API`, `Performance`, `Other`) are triage's to add.
3. Create a personal API key (Settings → API → Personal API keys), or an OAuth
   application if you would rather not tie it to one person. Both work: the
   client sends `lin_api_…` raw and `lin_oauth_…` as a Bearer token.
4. Find the team's UUID. The simplest way is one query against the API:

   ```bash
   curl -s https://api.linear.app/graphql \
     -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
     -d '{"query":"{ teams { nodes { id key name } } }"}'
   ```

5. Connect the GitHub integration (Settings → Integrations → GitHub) to this
   repository, so a branch or PR naming `BEV-104` links itself to the issue.
   Leave the "close on merge" automation **off**: a merged PR is not a verified
   fix, and the workflow depends on that distinction.
6. Check the plan's issue cap before anyone beyond the two of you gets the
   `tester` role: the free plan limits active issues, which is fine for two
   people and worth knowing about before friends start filing.

### 2. Supabase secrets

```bash
supabase secrets set \
  LINEAR_API_KEY=... \
  LINEAR_TEAM_ID=...
# optional
supabase secrets set LINEAR_PROJECT_ID=... LINEAR_LABEL_IDS=id1,id2 \
  LINEAR_TRIAGE_STATE_ID=... LINEAR_DONE_STATE_ID=... \
  LINEAR_LABEL_BUG=... LINEAR_LABEL_FIX=... LINEAR_LABEL_IDEA=... LINEAR_LABEL_DESIGN=...
```

| Variable | Required | What it does |
|---|---|---|
| `LINEAR_API_KEY` | yes | The credential. Server-only. |
| `LINEAR_TEAM_ID` | yes | Which team the issue is created in, and whose issues the status route reads. |
| `LINEAR_PROJECT_ID` | no | Puts new issues in a project. |
| `LINEAR_LABEL_IDS` | no | Comma-separated labels on every submission, e.g. one "from the app" label. |
| `LINEAR_LABEL_BUG`, `LINEAR_LABEL_FIX`, `LINEAR_LABEL_IDEA`, `LINEAR_LABEL_DESIGN` | no | The label id for each Type. Without them the function finds the label by name. |
| `LINEAR_TRIAGE_STATE_ID` | no | Skips the per-cold-start lookup of the team's Triage state. |
| `LINEAR_DONE_STATE_ID` | no | Skips the lookup of the team's Done state, which `markVerified` moves a ticket to. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into Edge Functions automatically; do not set them by hand.

Locally, the same values go in `supabase/.env` (gitignored).

### 3. Deploy

```bash
supabase db push                           # 20261109000300_bug_reports.sql
supabase functions deploy bug-report       # the function
```

Note that `supabase secrets set` is separate from deploying — deploying the
function does not carry the secrets with it.

### 4. The MCP connection, for coding agents

`.mcp.json` in the repository root declares Linear's official remote MCP server
for Claude Code (`/mcp` in a session, pick `linear`, authorise in the browser).
Codex configures it per machine:

```bash
codex mcp add linear --url https://mcp.linear.app/mcp
codex mcp login linear
```

Both require an **interactive browser authorisation** the first time. Until
that authorisation has actually been completed on the machine in question, an
agent cannot read a ticket — and should say so rather than guessing at its
contents.

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

## The Linear views to configure

These replace the dashboard mockup. Create them as saved views in the team's
sidebar, in this order:

| View | Filter | Sort |
|---|---|---|
| **All issues** | none | Updated, newest first |
| **Triage** | state = Triage | Created, oldest first (the queue) |
| **Active** | state in Todo, In Progress, In Review | Priority, then updated |
| **Bugs** | label = Bug | Priority, then updated |
| **Completed** | state = Done | Completed, newest first |

Keep the list rows to identifier, title, label, priority, state and age —
Linear's default row, which is already that. Resist adding charts until
there is enough history for one to mean anything.

## How the form's fields reach Linear

| In the form | On the ticket |
|---|---|
| **What is it?** Bug / Fix suggestion / Idea / Design nit | The label of the same name, and a `**Type:**` line under the opening quote |
| **How bad is it?** Blocker / Bad / Annoying / Polish | Priority 1 / 2 / 3 / 4 (Urgent / High / Medium / Low), and a `**Severity:**` line |
| What went wrong? | The title |
| Describe the problem, steps, expected, actual | Their sections |
| Automatically included | The Environment section |
| The components pointed at (up to 6) | The **Pointed at** section, directly after Summary: one numbered block per component (its mark, else its position) with the source file, ancestry, role and label, text, props, how it was drawn, where it sat on screen, and which screenshot and mark show it. Only lines with data are printed; with none, the section says the note is about the whole screen. |
| Steps the app recorded (`stepsSource: 'recorded'`) | The same numbered list, under a line saying the app recorded them from the reporter's screens and taps |
| The app's recent activity trail | The Recent activity section, a fenced block of one line per entry: `nav`, `api`, `tap` (what was tapped) and `error` (the message) |
| Screenshots (up to 3), each with an optional caption | Images in the Evidence section, each uploaded to Linear's own storage and numbered by its place in the list (the number a pointed-at component's "Screenshot N" refers to). A caption becomes the image's alt text and an italic line under it. |
| The "which is worse?" placement after filing | The issue's `sortOrder` (Linear's manual order) and its priority, by the bands above; My reports reads the rank back from `sortOrder`, so a drag in Linear moves it there too |

Triage may change the priority or the label with the board in view; Linear's
values are the truth from then on, and My reports shows Linear's state. A
later placement from the app does set the priority again from the new
position, except on an Urgent ticket.

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
| `supabase/functions/bug-report/test.ts` (Deno, 85 tests) | Redaction; the environment allow-list (including the dropped query-string path and the typed pixel ratio and reduced-motion values), the breadcrumb allow-list (tap and error entries, the 40 cap) and the target allow-list (bad component names, `..` in a file, the 12-entry prop cap, range checks, the 6-target cap) and captions; kind/severity and path validation; the issue template (type and severity line, the exact Pointed at markdown for a full target, a sparse one and none, backticks that cannot close a code span, the recorded-steps line, recent activity, numbered and captioned evidence); every function in `rank.ts` (top, bottom, middle, alone, respacing, the bands, Urgent kept); `routeOf` and the place route's body; the priority mapping, label resolution, state mapping, the Linear client's error mapping, two-step upload, the status query (which selects `sortOrder`), the verify write and `placeIssue`'s request; the reporter-scoped ledger query and the retried ledger write — all against an injected `fetch`. The place route's handler itself (`handlePlace` in `index.ts`) is not exercised: index.ts starts a server when imported. |
| `supabase/tests/28_bug_reports.test.sql` (pgTAP, 65 assertions) | The `tester` role and `set_profile_role` (the trigger still refuses a plain update, even from the owner; `authenticated` cannot call it; the bypass flag is reset), the grants (notably that `authenticated` cannot call `finish_bug_report`), the RLS shape, the private bucket and its policy, the authorisation refusal, kind/severity/title/path validation (an over-long title included), the idempotency ledger's cases (in-flight, stale-pending re-arm keeping staged evidence, failed re-arm taking the retry's list), cross-reporter reads returning nothing, the 20-an-hour rate limit, and `forget_bug_evidence`. |
| `packages/api/test/bugs.test.ts` (vitest, 30 cases) | That nothing is uploaded or invoked before the input validates, that every screenshot goes to the private bucket in order and the function gets only paths (and one caption per path), that targets and the steps source are sent, that no credential is in the request body, the error-code mapping, `listMine` over the status route (including `rank`), `markVerified` over the verify route, `place` over the place route (validation, its own not-found versus a bare 404 from a server that predates ranking, tracker failures), and the refusal of a response with no confirmed ticket. |
| `app/src/testing/conformance.ts` against the FakeApi (jest) | The bugs refusals for an ordinary and a signed-out account, and, with an internal reporter, `rank` on `listMine` (a new ticket at the top), `place` to the top and below another ticket with the new ranks and priorities, Urgent kept, and its validation and not-found cases (a closed ticket, another reporter's ticket). |
| `app/src/features/bug-report/__tests__/` (jest) | The form's type and severity controls, required-title, success, duplicate, failure-with-retry and draft-restore states; that the screenshot never reaches storage and is sent as a one-element list; the context preview; and the launcher's gating, route capture and absence from the full-screen modals: it is a header action, first in every shared `Header`'s icons, with a floating pill only on the not-found page, which has no header. |

**Not covered, honestly:** the live round trip to Linear. No test in this
repository has ever called `api.linear.app`, because no credential exists here
to call it with. `linear.ts` is written against Linear's documented GraphQL
API and its shapes are asserted against recorded-looking responses, which is
not the same as having seen the real one. In particular, **the `place` route,
the `sortOrder` read and write, the rank on the status route, and everything
else added for the pointed-at components and the ranked list have never run
against the real Linear API.** What they rely on is Linear's published SDK
schema: `Issue.sortOrder: Float!` (lower first; a value between two
neighbours places an issue between them; Linear may adjust positions to avoid
collisions), `IssueUpdateInput.sortOrder` and `IssueUpdateInput.priority`.
That a new issue lands at the top of the manual order, and how Linear's own
collision adjustment interacts with the midpoints written here, are
assumptions until someone has watched it. The first real submission is a manual
test, and it should be treated as one — see the end-to-end checklist in
[`bug-workflow.md`](./bug-workflow.md).

## Deliberate omissions

- **No console capture.** The breadcrumb trail is navigations, failed API
  calls (method name, code, status, duration), taps (the component and its
  label) and uncaught errors (the message only, redacted and capped at 200
  characters; never a stack or arguments). Captured `console.error` output is
  the easiest way to leak user content into a ticket, and nothing has needed
  it yet.
- **No duplicate detection, aging metrics or auto-triage.** Linear has search;
  the rest is premature before there is history to measure.
- **No error-monitoring correlation.** There is no Sentry (or equivalent) in
  this repository to correlate with. When there is, the correlation ID belongs
  in the environment allow-list in `redact.ts` and `context.ts`.
