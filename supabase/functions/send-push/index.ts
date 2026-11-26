// send-push: delivers Bevi's push notifications (T-31, Release 2) through
// Expo's push service, from the queue in `public.push_outbox`.
//
// It never decides who gets what. The database queued each push when it
// happened (20261127000100) and `claim_push_batch()` judges it at send time --
// paused, the kind switched off, no device, a block either way, the age gate,
// or no longer true -- so a push this function can see is one that may go out.
// This function only words it, sends it, and reports back.
//
// Callers, and only these two:
//   1. the `poke_push_sender` trigger over pg_net, after a push is queued --
//      a latency optimisation that may be lost;
//   2. `drain_push_outbox()` from pg_cron every minute, the actual guarantee.
//
// ---------------------------------------------------------------------------
// AUTHORISATION: verify_jwt is OFF (config.toml), and this function checks a
// shared secret itself, for the reasons generate-bev-icon spells out:
// verify_jwt only proves a key the project issued, and the publishable key
// ships in every copy of the app; neither real caller holds a user JWT. So the
// gate is PUSH_WEBHOOK_SECRET and ONLY that, compared in constant time. It
// never falls back to the service-role key: the poke and the drain send the
// token as a pg_net header, and pg_net persists headers in
// `net.http_request_queue`. With no secret this function refuses everything.
//
// THE KILL SWITCH. Nothing is claimed or sent unless PUSH_SENDING_ENABLED is
// exactly `true`. Deployed and configured but not enabled, it answers
// `{ disabled: true }` and leaves the queue alone.
// ---------------------------------------------------------------------------
//
// Deno conventions follow its siblings: no remote imports (`deno.json` has an
// empty import map), plain `fetch` to PostgREST and to Expo, so `deno check`
// resolves nothing off the network.

import { createSender } from './sender.ts';

Deno.serve(createSender({ env: (name) => Deno.env.get(name) }));
