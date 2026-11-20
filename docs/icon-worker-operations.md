# BEV-15: generated icon worker readiness

The worker is **off by default**. New photo-backed Bevs are automatically
queued, but no provider calls happen until the worker is enabled. This is
preparation for a controlled rollout, not authorization to enable generation.

## Completed production blockers

- [x] Allow `application/json` in the private style-reference bucket so the
  existing uploader can store the `index.json` the worker requires.
- [x] Require `ICON_GENERATION_ENABLED=true` before normal requests claim work.
- [x] Validate provider configuration and the complete reference set before
  claiming, so broken deployment configuration consumes no job attempts.
- [x] Verify reference hashes, dimensions, paths and bounded sizes; fail closed
  instead of silently spending a call with missing style references.
- [x] Bound database/storage request durations and response bytes.
- [x] Report processing exceptions immediately through the failure RPC.
- [x] Return HTTP 503 when outcome reporting fails, including network exceptions.
- [x] Log structured outcome, duration and reporting status without raw secrets,
  request bodies or exception text.
- [x] Add an authenticated, non-generating deployment preflight and checker.
- [x] Test the handler without starting a server or calling a model.
- [x] Fence every claim with a unique token and use an immutable object path per
  attempt; stale workers cannot publish, finish, or release newer claims.
- [x] Automatically queue photo-backed Bev creation; photo-less Bevs create no
  icon job. The durable job is independent of provider availability.
- [x] Retry transient failures with backoff and keep permanent failures
  terminal. Old unfenced worker RPCs are revoked from the service role.

The root cause of the reference deployment blocker was a mismatch between
`export-style-refs.mjs`, which uploads `index.json` as `application/json`, and
the original bucket migration, which allowed only PNG/JPEG. The fix is the
append-only `20261119192919_bev_style_reference_index.sql`; earlier migrations
are unchanged. The bucket remains private with the existing one MiB object cap.
`20261119192921_bev_icon_auto_enqueue.sql` restores automatic first-pass
behavior: each new photo-backed Bev queues one job. It leaves older incomplete
jobs terminal so enabling the worker does not unexpectedly backfill a backlog.

## Deploy with generation disabled

1. Integrate the backend branch and review pending migrations, including the
   reference-index MIME fix. Apply migrations through the existing deployment
   process and backup policy. This document does not enable automatic DB push.
2. Deploy `generate-bev-icon` with the new handler and keep
   `ICON_GENERATION_ENABLED=false` (unset also disables it). Set matching
   `ICON_WEBHOOK_SECRET` / Vault `icon_webhook_token` only as part of the
   approved deployment. Never use the service-role key as the webhook secret.
3. Supply `CF_ACCOUNT_ID` and `CF_API_TOKEN` as function secrets. Supabase
   supplies its own URL/service-role environment to the deployed function.
4. Upload unbranded references using the existing exporter, **after** the MIME
   migration. Verify that uploading the final JSON index succeeds as well as
   uploading the images. No successful hosted reference upload is claimed by
   these local changes.
5. Run the signed preflight below. It must report `ready: true`, at least three
   references, `generationEnabled: false`, and `claimed: 0`.
6. Keep generation disabled until the real-photo quality benchmark is ready.
   New Bev jobs remain queued while disabled; enabling is a separate release
   step and will begin processing the queue.

```sh
deno run --env-file=supabase/.env --allow-env=ICON_WEBHOOK_SECRET \
  --allow-net=YOUR_PROJECT.supabase.co \
  supabase/functions/generate-bev-icon/check.ts \
  --url https://YOUR_PROJECT.supabase.co/functions/v1/generate-bev-icon
```

The checker makes one authenticated POST with `?mode=preflight`. It uses only
the webhook secret, follows no redirects, never claims a job, and never calls
Cloudflare. It prints only the validated readiness fields. This verifies that
the function has provider variables and can read/validate the private
references; it **does not** prove provider credentials are valid, bucket writes
work, migrations are current, or the app displays generated art.
An actual capped evaluation and pilot end-to-end check establish those parts.

The webhook requires authentication even while disabled. A normal authenticated
POST when disabled returns `{ "claimed": 0, "disabled": true }` with no database
or storage calls. In-flight calls that already passed the switch may finish;
the switch prevents new claims, not cancellation. `create_bev` records the
original photo and creates one durable job in the same transaction. A missing
photo creates no job. The database best-effort notification wakes the worker;
the scheduled drain is the fallback. Turning off the worker does not delete
queued jobs. Jobs that age past the queue lifetime are marked terminal when
processing resumes.

## Failure behavior

| Condition | Worker behavior |
|---|---|
| Wrong bearer / method | 401 / 405; no queue access |
| Missing provider variables | 503 before claim |
| Missing/corrupt reference index or image | 503 before claim |
| Transient source/provider/storage failure after claim | Record retryable failure and schedule bounded backoff |
| Invalid or permanent source/provider failure | Record terminal failure |
| Provider quota exhaustion | Release without consuming an attempt |
| Old worker reports after lease replacement | RPC returns `false`; worker reports `stale`, never overwrites current state |
| Outcome RPC rejects or cannot be reached | 503; log `report_failed`; lease recovery remains the backstop |
| Job outcome is successfully persisted | 200; inspect `results[].outcome` for completed/failed/release |

HTTP 200 means the invocation handled and persisted the outcome, not that an
icon passed visual review. No change here makes generated artwork automatically
approved.

## Verification performed

- `deno test --allow-net --allow-env supabase/functions/generate-bev-icon/`: 55
  passed, including 17
  handler/readiness/HTTP tests and the prior image/evaluation tests.
- `deno check` for worker entry, evaluation CLI and preflight checker: passed.
- Changed TypeScript modules linted; `git diff --check` passed.
- The six-assertion MIME regression test reproduced two failures against the
  old configuration and passed all six after the migration, in a rolled-back
  transaction against local Supabase.
- All 43 SQL test files passed cumulatively against the current migration set,
  each in an isolated rollback transaction. The four icon suites contain 54
  assertions covering MIME, auto-enqueue, claim fencing and failure handling.
- `npm run typecheck`, API tests (135 passed, 21 live tests skipped), and FakeApi
  conformance (83 passed) passed after removing the credit/request flow.
- No clean DB reset, production migration, hosted deploy or model call was
  performed for this change. The existing shared local database was not reset.

The transactional check loaded pgTAP in the transaction because it was not
installed in the running local database. A full clean-stack migration replay
and complete DB suite are still required before a PR is ready for review.

## Remaining production work

- Decide and implement regeneration/candidate review semantics after the icon
  and badge direction are agreed. The first pass generates one candidate per
  photo-backed Bev and does not offer regeneration or selection.
- Run a clean local migration replay and full `supabase test db` suite from the
  production migration chain; the current local database checks inject new
  migrations inside rolled-back tests rather than resetting the shared stack.
- Deploy with the worker off, upload style refs, verify preflight against the
  hosted function, and perform an explicitly approved capped live evaluation.
- After the photo benchmark and visual review pass, enable the worker for a
  limited rollout. It will process existing eligible queued Bevs and new ones;
  inspect the backlog age before enabling it.
- Collect the real-photo benchmark and human review required by
  [`icon-quality-evaluation.md`](icon-quality-evaluation.md). Technical pipeline
  success does not approve the image.
- Only after these checks, run a limited pilot with monitoring and a rollback
  owner. No production deployment or switch activation has been performed here.
