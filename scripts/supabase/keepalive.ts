/**
 * Keeps a hosted Supabase project from pausing: a free project is paused after
 * a week with no API activity and never resumes itself (DEVELOPMENT-ARJUN.md
 * §2.3). Until a store binary is on Pro, this is what keeps the clock from
 * running out.
 *
 *   npm run supabase:keepalive
 *
 * One request: `POST /rest/v1/rpc/ping` with the PUBLISHABLE key, which is the
 * `anon` role. `public.ping()` is `select now()` and nothing else
 * (supabase/migrations/20261118214500_ping.sql). It has to be a real HTTP
 * request from outside: the reported pause trigger is "no API activity", and
 * it is not confirmed that pg_cron activity inside the database counts (§2.3),
 * so a schedule living in the database would be exactly the thing that might
 * not work.
 *
 * Run daily by .github/workflows/supabase-keepalive.yml, once per hosted
 * project. Node 22, no build step and no dependencies, like scripts/graph/*.
 *
 * Environment, one project per invocation:
 *   SUPABASE_URL               https://<ref>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY   the publishable/anon key -- never a secret key
 *   SUPABASE_PROJECT_LABEL     optional, for the log line (e.g. `bevi-prod`)
 *
 * If SUPABASE_URL is unset it exits 0 with a warning, so the schedule stays
 * green until the secrets are added -- the same bargain scripts/graph/keepalive.ts
 * makes.
 *
 * Nothing here ever prints the key: a failure prints the status and the
 * response body, both of which are the server's words, not ours.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const label = process.env.SUPABASE_PROJECT_LABEL || "the Supabase project";

if (!url) {
  console.log(
    `::warning::SUPABASE_URL is not set; the keep-alive for ${label} was skipped. See DEVELOPMENT-ARJUN.md §2.3.`
  );
  process.exit(0);
}
if (!key) {
  console.error(
    `supabase:keepalive failed (${label}): SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_URL is set.`
  );
  process.exit(1);
}
// A secret key would work and must never be here: this runs with the key the
// app itself ships with, and RLS is the boundary (supabase/CLAUDE.md).
if (key.startsWith("sb_secret_") || key.includes("service_role")) {
  console.error(
    `supabase:keepalive failed (${label}): SUPABASE_PUBLISHABLE_KEY looks like a secret/service-role key. Use the publishable key.`
  );
  process.exit(1);
}

const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/rpc/ping`;

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });

  const text = (await response.text()).trim();

  if (!response.ok) {
    // A paused project answers from the platform rather than from PostgREST,
    // so this is also what "it already paused" looks like: restore it from the
    // dashboard, then work out why the schedule stopped running.
    throw new Error(`${response.status} ${response.statusText}\n  body: ${text}`);
  }

  // The body is the JSON-encoded timestamptz ping() returned, quotes included.
  console.log(`supabase keep-alive ok (${label}): ping() returned ${text}`);
} catch (error: unknown) {
  console.error(
    `supabase:keepalive failed (${label}) at ${endpoint}\n${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
