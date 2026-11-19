// generate-bev-icon: turns a user's beverage photograph into an illustrated
// Bevi icon, asynchronously, for a Bev that was created WITH a photo.
//
// It never decides eligibility. `create_bev` already did that, inside the
// transaction that created the Bev (20261119185800), and the only work this
// function can see is what `claim_bev_icon_jobs()` hands it. A Bev with no job
// row is a Bev this function cannot touch.
//
// Callers, and only these two:
//   1. `enqueue_bev_icon_job()` over pg_net, the moment an eligible Bev is
//      created -- a latency optimisation that may be lost;
//   2. `drain_bev_icon_jobs()` from pg_cron every minute, which is the actual
//      guarantee and is why none of this depends on anyone's browser.
//
// ---------------------------------------------------------------------------
// AUTHORISATION: verify_jwt is OFF (config.toml), and this function checks a
// shared secret itself -- the same reasoning the `embed` function spells out.
// `verify_jwt` only proves the request carries a key the project issued, and
// the publishable key ships in every copy of the app. This function writes as
// the service role and spends a metered daily allocation per call, so "anyone
// who installed the app" is precisely the wrong audience. Neither real caller
// holds a user JWT anyway: pg_net sends whatever header the SQL built.
//
// So the gate is ICON_WEBHOOK_SECRET and ONLY that. It does NOT fall back to
// the service-role key: that would quietly make an RLS-bypassing credential
// the webhook password, and because `enqueue_bev_icon_job` and
// `drain_bev_icon_jobs` send the token as a pg_net header, pg_net would then
// persist that key in `net.http_request_queue` on every eligible create and
// every minute of cron. With no secret configured this function refuses every
// request, which is a loud failure instead of a silent exposure.
// ---------------------------------------------------------------------------
//
// Deno conventions follow `embed`: no remote imports (`deno.json` has an empty
// import map), plain `fetch` against PostgREST, so `deno check` type-checks
// this file without resolving a single module off the network. The PNG and
// JPEG codecs are ours for the same reason -- see their headers.

import { createWorker } from './worker.ts';

Deno.serve(createWorker({ env: (name) => Deno.env.get(name) }));
