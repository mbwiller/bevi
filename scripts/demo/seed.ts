/**
 * IA-8: seeds the App Review demo account and the small world around it.
 *
 *   npm run demo:seed -- --dry-run      # build and check the plan; no credentials, no network
 *   npm run demo:seed                   # seed the LOCAL stack, then verify through the app's RPCs
 *   npm run demo:seed -- --verify-only  # only the verification, as the demo account
 *
 * The plan (who exists, what they ranked and when, follows, likes, comments)
 * is scripts/demo/plan.ts. This file makes it true, through the same RPCs the
 * app calls, signed in as each person: `submit_ranking`, `follow_user`,
 * `add_want_to_try`, `like_post`, `add_comment`, `set_birth_date`, and the
 * `profiles` own-row update `updateMe` uses. Nothing is inserted into a
 * content table directly. The only service-role writes are: creating the
 * auth users (GoTrue admin API, with the invite code in their metadata, so
 * `handle_new_user`'s gate is passed the normal way), resetting a seeded
 * account's password when it no longer matches, and BACKDATING the rows a
 * submission, like or comment just created, so the feed reads as a week of
 * activity and the streak is a real run of days. Backdating happens one
 * submission at a time, before that person's next submission, because
 * `touch_streak` recomputes the streak from `ranking_events` on every submit:
 * the last submission (always today, plan.ts guarantees it) then leaves the
 * correct streak behind, with no formula reimplemented here.
 *
 * IDEMPOTENT. Every step reads what exists first and writes only what is
 * missing: an account, a ranking (user, Bev), a follow, a want, a like
 * (user, post), a comment (user, post, body), a profile field. A second run
 * writes nothing and prints "0 written" for every step. A run on a later day
 * also writes nothing: the timestamps stay where the first run put them, so
 * the streak decays as it would for a real person. To freshen the account
 * before a review round, delete the seeded people (Dashboard > Auth) and run
 * it again -- every seeded row cascades from the profile.
 *
 * TARGET, AND THE HOSTED GUARD. There is one hosted Supabase project and it
 * is the live one. So:
 *
 *  - a local URL (127.0.0.1, localhost) needs nothing extra;
 *  - any other URL is refused unless BOTH `--hosted` is passed AND
 *    `BEVI_SEED_ALLOW_HOSTED` equals the project ref parsed out of
 *    `https://<ref>.supabase.co`. The ref is printed, and the run waits ten
 *    seconds before writing anything. A URL that is not `<ref>.supabase.co`
 *    is refused outright: if we cannot name the project, we do not write to it.
 *  - a hosted run also requires `BEVI_DEMO_PASSWORD`; there is no default.
 *
 * Credentials, from the environment (supabase/.env, which `npm run` loads),
 * as every other script here reads them:
 *
 *   SUPABASE_URL                the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY   the service-role key. Never printed.
 *   BEVI_DEMO_PASSWORD          the password every seeded account gets. Never
 *                               printed. Optional locally (see LOCAL_PASSWORD).
 *   BEVI_SEED_ALLOW_HOSTED      the one hosted project ref a --hosted run may touch.
 *
 * For the local stack, `npx supabase status -o env` prints the URL and the
 * (well-known, local-only) service-role key.
 *
 * The invite code is not configured here: it is read from `app_secrets`, the
 * row `handle_new_user` checks, and printed only for a local target.
 */

import {
  MIN_N_USER,
  MIN_RATERS,
  RANKING_VERSION,
  flavorTokens,
  normaliseBrand,
  recommend,
  type BevFeatures,
  type PredictionSnapshot,
  type Stats,
  type UserSnapshot,
} from "@bevi/ranking";

import { buildPlan, type Plan, type ResolvedPerson } from "./plan.ts";

/** `packages/api/src/client.ts`'s SYNTHETIC_EMAIL_DOMAIN: a username signs in as <username>@users.bevi.app. */
const EMAIL_DOMAIN = "users.bevi.app";

/**
 * The password a LOCAL run gives the seeded accounts when BEVI_DEMO_PASSWORD
 * is unset. Local stack only -- a hosted run refuses without the env var --
 * in the same spirit as seed.sql's 'local-test-invite-code'. Not one of
 * check-bundle.mjs's forbidden strings.
 */
const LOCAL_PASSWORD = "local-review-seed-pw";

const HOSTED_WAIT_MS = 10_000;

function die(message: string): never {
  console.error(`demo:seed: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

interface Target {
  url: string;
  key: string;
  password: string;
  hosted: boolean;
  /** The project ref, for a hosted target. */
  ref: string | null;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

export function resolveTarget(env: NodeJS.ProcessEnv, argv: readonly string[]): Target {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) die("SUPABASE_URL is not set (supabase/.env, or `npx supabase status -o env` for the local stack)");
  if (!key) die("SUPABASE_SERVICE_ROLE_KEY is not set");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    die("SUPABASE_URL is not a URL");
  }

  if (isLocalHost(parsed.hostname)) {
    if (argv.includes("--hosted")) die("--hosted was passed but SUPABASE_URL is the local stack; drop the flag");
    return { url, key, password: env.BEVI_DEMO_PASSWORD || LOCAL_PASSWORD, hosted: false, ref: null };
  }

  // Anything else is hosted, and gets every check.
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  if (!match) die(`refusing: ${parsed.hostname} is neither the local stack nor a <ref>.supabase.co project`);
  const ref = match[1] as string;
  if (!argv.includes("--hosted")) {
    die(`refusing: SUPABASE_URL is the HOSTED project ${ref}. This script only touches a hosted project with --hosted and BEVI_SEED_ALLOW_HOSTED=${ref}.`);
  }
  if (env.BEVI_SEED_ALLOW_HOSTED !== ref) {
    die(`refusing: BEVI_SEED_ALLOW_HOSTED does not name ${ref}. Set it to exactly that ref to allow this one project.`);
  }
  if (!env.BEVI_DEMO_PASSWORD) die("refusing: a hosted run needs BEVI_DEMO_PASSWORD; there is no default password for a real project");
  return { url, key, password: env.BEVI_DEMO_PASSWORD, hosted: true, ref };
}

// ---------------------------------------------------------------------------
// HTTP: PostgREST and GoTrue, plain fetch, no dependencies
// ---------------------------------------------------------------------------

class Http {
  readonly url: string;
  readonly key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  private async send(path: string, init: RequestInit, token: string | null, what: string): Promise<unknown> {
    const res = await fetch(`${this.url}${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        // A user's JWT when acting as that user (PostgREST then runs as
        // `authenticated` with their auth.uid()); the service key otherwise.
        authorization: `Bearer ${token ?? this.key}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      // The key travels in a header, never in the path or the body, so the
      // error is safe to print.
      throw new Error(`${what}: ${res.status} ${text.slice(0, 500)}`);
    }
    return text === "" ? null : JSON.parse(text);
  }

  /** A PostgREST read, as the service role unless a user token is given. */
  select<T>(path: string, token: string | null = null): Promise<T[]> {
    return this.send(`/rest/v1/${path}`, { method: "GET" }, token, `GET ${path.split("?")[0]}`) as Promise<T[]>;
  }

  rpc<T>(name: string, body: Record<string, unknown>, token: string | null): Promise<T> {
    return this.send(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }, token, name) as Promise<T>;
  }

  /** Service role only: used for backdating and nothing else. */
  async patch(path: string, body: Record<string, unknown>): Promise<number> {
    const rows = (await this.send(
      `/rest/v1/${path}`,
      { method: "PATCH", body: JSON.stringify(body), headers: { prefer: "return=representation" } },
      null,
      `PATCH ${path.split("?")[0]}`,
    )) as unknown[];
    return rows.length;
  }

  /** As a user: the `profiles` own-row update `updateMe` makes. */
  async patchAs(path: string, body: Record<string, unknown>, token: string): Promise<void> {
    await this.send(`/rest/v1/${path}`, { method: "PATCH", body: JSON.stringify(body), headers: { prefer: "return=minimal" } }, token, `PATCH ${path.split("?")[0]}`);
  }

  adminCreateUser(email: string, password: string, inviteCode: string): Promise<{ id: string }> {
    return this.send(
      "/auth/v1/admin/users",
      // user_metadata lands in raw_user_meta_data, where handle_new_user reads
      // invite_code: exactly what packages/api's signUp passes.
      { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { invite_code: inviteCode } }) },
      null,
      "auth admin create user",
    ) as Promise<{ id: string }>;
  }

  async adminSetPassword(userId: string, password: string): Promise<void> {
    await this.send(`/auth/v1/admin/users/${userId}`, { method: "PUT", body: JSON.stringify({ password }) }, null, "auth admin set password");
  }

  /** The password grant `signInWithPassword` uses. Null on bad credentials. */
  async signIn(email: string, password: string): Promise<string | null> {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.key, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`sign in: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }
}

const inList = (values: readonly string[]): string => `in.(${values.join(",")})`;
const iso = (d: Date): string => d.toISOString();

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface Account {
  person: ResolvedPerson;
  id: string;
  token: string;
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  onboarded: boolean;
  timezone: string;
  birth_date: string | null;
}

class Tally {
  private counts = new Map<string, { written: number; present: number }>();

  add(step: string, written: boolean): void {
    const c = this.counts.get(step) ?? { written: 0, present: 0 };
    if (written) c.written += 1;
    else c.present += 1;
    this.counts.set(step, c);
  }

  print(): number {
    let total = 0;
    for (const [step, c] of this.counts) {
      console.log(`  ${step.padEnd(22)} ${String(c.written).padStart(3)} written, ${String(c.present).padStart(3)} already present`);
      total += c.written;
    }
    return total;
  }
}

async function readInviteCode(http: Http): Promise<string> {
  const rows = await http.select<{ value: string }>("app_secrets?key=eq.invite_code&select=value");
  const code = rows[0]?.value;
  if (!code) die("app_secrets has no invite_code row, so nobody can sign up; set one first");
  return code;
}

/** Accounts: create the missing ones, sign everyone in, fix profile fields. */
async function ensureAccounts(http: Http, plan: Plan, target: Target, tally: Tally): Promise<Map<string, Account>> {
  const inviteCode = await readInviteCode(http);
  const handles = plan.people.map((p) => p.handle);
  const existing = new Map(
    (await http.select<ProfileRow>(`profiles?handle=${inList(handles)}&select=id,handle,display_name,onboarded,timezone,birth_date`)).map((r) => [r.handle, r]),
  );

  const accounts = new Map<string, Account>();
  for (const person of plan.people) {
    const email = `${person.handle}@${EMAIL_DOMAIN}`;
    let id = existing.get(person.handle)?.id;
    if (id === undefined) {
      id = (await http.adminCreateUser(email, target.password, inviteCode)).id;
      tally.add("accounts", true);
    } else {
      tally.add("accounts", false);
    }

    let token = await http.signIn(email, target.password);
    if (token === null) {
      // A seeded account whose password is not this run's: the run owns these
      // accounts, so it puts the password back rather than failing.
      await http.adminSetPassword(id, target.password);
      tally.add("password resets", true);
      token = await http.signIn(email, target.password);
      if (token === null) die(`@${person.handle} still cannot sign in after a password reset`);
    }
    accounts.set(person.handle, { person, id, token });
  }

  // Re-read: new accounts have the profile handle_new_user just made.
  const profiles = new Map(
    (await http.select<ProfileRow>(`profiles?handle=${inList(handles)}&select=id,handle,display_name,onboarded,timezone,birth_date`)).map((r) => [r.handle, r]),
  );
  for (const account of accounts.values()) {
    const p = account.person;
    const row = profiles.get(p.handle) ?? die(`@${p.handle} has no profile row after sign-up`);

    const patch: Record<string, unknown> = {};
    if (row.display_name !== p.displayName) patch.display_name = p.displayName;
    if (row.timezone !== p.timezone) patch.timezone = p.timezone;
    if (!row.onboarded) patch.onboarded = true;
    if (Object.keys(patch).length > 0) {
      await http.patchAs(`profiles?id=eq.${account.id}`, patch, account.token);
      tally.add("profile fields", true);
    } else {
      tally.add("profile fields", false);
    }

    // IS-3: the birth date is what makes alcohol visible; plan.ts BIRTH_DATES.
    // set_birth_date is write-once, so a date already there is left alone --
    // and if it is not the planned one, that is worth stopping for.
    if (row.birth_date === null) {
      await http.rpc("set_birth_date", { p_date: p.birthDate }, account.token);
      tally.add("birth dates", true);
    } else if (row.birth_date !== p.birthDate) {
      die(`@${p.handle} already has birth_date ${row.birth_date}, not the planned ${p.birthDate}; fix it by hand (it decides alcohol visibility)`);
    } else {
      tally.add("birth dates", false);
    }
  }
  return accounts;
}

async function ensureFollows(http: Http, plan: Plan, accounts: Map<string, Account>, tally: Tally): Promise<void> {
  const ids = [...accounts.values()].map((a) => a.id);
  const have = new Set(
    (await http.select<{ follower_id: string; followee_id: string }>(`follows?follower_id=${inList(ids)}&select=follower_id,followee_id`)).map(
      (r) => `${r.follower_id}>${r.followee_id}`,
    ),
  );
  for (const [from, to] of plan.follows) {
    const a = accounts.get(from) as Account;
    const b = accounts.get(to) as Account;
    if (have.has(`${a.id}>${b.id}`)) {
      tally.add("follows", false);
      continue;
    }
    await http.rpc("follow_user", { p_user_id: b.id }, a.token);
    tally.add("follows", true);
  }
}

/**
 * Rankings, in one global chronological order so `feed_events.id` (the feed's
 * sort key) agrees with the backdated `created_at`. Each submission appends to
 * its bucket with an empty comparison log, which `assert_comparison_log`
 * accepts, so a person's bucket order is the plan's order.
 */
async function ensureRankings(http: Http, plan: Plan, accounts: Map<string, Account>, tally: Tally): Promise<void> {
  const ids = [...accounts.values()].map((a) => a.id);
  const existing = await http.select<{ user_id: string; bev_id: string; bucket: number }>(
    `rankings?user_id=${inList(ids)}&select=user_id,bev_id,bucket&order=id`,
  );
  const ranked = new Set(existing.map((r) => `${r.user_id}|${r.bev_id}`));
  const bucketSize = new Map<string, number>();
  for (const r of existing) bucketSize.set(`${r.user_id}|${r.bucket}`, (bucketSize.get(`${r.user_id}|${r.bucket}`) ?? 0) + 1);

  // Every planned Bev must exist and be active before anything is written.
  const planned = [...new Set(plan.people.flatMap((p) => [...p.rankings.map((r) => r.bev.bevId), ...p.wantToTry.map((w) => w.bevId)]))];
  const active = new Set(
    (await http.select<{ id: string }>(`bevs?id=${inList(planned)}&status=eq.active&select=id`)).map((r) => r.id),
  );
  for (const p of plan.people) {
    for (const r of [...p.rankings.map((x) => x.bev), ...p.wantToTry]) {
      if (!active.has(r.bevId)) die(`catalog Bev "${r.slug}" (${r.bevId}) is not an active row in this database; is the catalog seed migration applied?`);
    }
  }

  const queue = plan.people
    .flatMap((p) => p.rankings.map((r, i) => ({ account: accounts.get(p.handle) as Account, r, i })))
    .sort((x, y) => x.r.at.getTime() - y.r.at.getTime() || x.account.person.handle.localeCompare(y.account.person.handle) || x.i - y.i);

  for (const { account, r } of queue) {
    if (ranked.has(`${account.id}|${r.bev.bevId}`)) {
      tally.add("rankings", false);
      continue;
    }
    const sizeKey = `${account.id}|${r.bucketDb}`;
    const size = bucketSize.get(sizeKey) ?? 0;
    const rows = await http.rpc<Array<{ ranking: { id: string }; bucket_size: number }>>(
      "submit_ranking",
      {
        p_bev_id: r.bev.bevId,
        p_bucket: r.bucketDb,
        p_insert_index: size,
        p_expected_bucket_size: size,
        p_comparisons: [],
        p_note: r.note,
      },
      account.token,
    );
    const rankingId = rows[0]?.ranking.id ?? die(`submit_ranking returned no row for @${account.person.handle} / ${r.bev.slug}`);
    bucketSize.set(sizeKey, size + 1);
    tally.add("rankings", true);

    // Backdate what that submission created, before this person's next one.
    const at = iso(r.at);
    await http.patch(`rankings?id=eq.${rankingId}`, { ranked_at: at, updated_at: at });
    await http.patch(`feed_events?ranking_id=eq.${rankingId}`, { created_at: at });
    const events = await http.patch(`ranking_events?user_id=eq.${account.id}&bev_id=eq.${r.bev.bevId}&kind=eq.submit`, { created_at: at });
    if (events !== 1) die(`expected one ranking_events row for @${account.person.handle} / ${r.bev.slug}, backdated ${events}`);
  }
}

async function ensureWantToTry(http: Http, plan: Plan, accounts: Map<string, Account>, tally: Tally): Promise<void> {
  const ids = [...accounts.values()].map((a) => a.id);
  const have = new Set(
    (await http.select<{ user_id: string; bev_id: string }>(`want_to_try?user_id=${inList(ids)}&select=user_id,bev_id`)).map((r) => `${r.user_id}|${r.bev_id}`),
  );
  for (const p of plan.people) {
    const account = accounts.get(p.handle) as Account;
    for (const w of p.wantToTry) {
      if (have.has(`${account.id}|${w.bevId}`)) {
        tally.add("want to try", false);
        continue;
      }
      await http.rpc("add_want_to_try", { p_bev_id: w.bevId }, account.token);
      tally.add("want to try", true);
    }
  }
}

async function ensureReactions(http: Http, plan: Plan, accounts: Map<string, Account>, tally: Tally): Promise<void> {
  const ids = [...accounts.values()].map((a) => a.id);
  const events = await http.select<{ id: number; actor_id: string; bev_id: string }>(
    `feed_events?actor_id=${inList(ids)}&kind=eq.ranked&select=id,actor_id,bev_id&order=id`,
  );
  const eventId = new Map(events.map((e) => [`${e.actor_id}|${e.bev_id}`, e.id]));
  const postId = (actor: string, bevId: string): number => {
    const a = accounts.get(actor) as Account;
    return eventId.get(`${a.id}|${bevId}`) ?? die(`no feed event for @${actor} / ${bevId}; did its ranking fail?`);
  };

  const likes = new Set(
    (await http.select<{ user_id: string; feed_event_id: number }>(`post_likes?user_id=${inList(ids)}&select=user_id,feed_event_id`)).map(
      (r) => `${r.user_id}|${r.feed_event_id}`,
    ),
  );
  for (const like of plan.likes) {
    const by = accounts.get(like.by) as Account;
    const post = postId(like.post.actor, like.post.bev.bevId);
    if (likes.has(`${by.id}|${post}`)) {
      tally.add("likes", false);
      continue;
    }
    await http.rpc("like_post", { p_event_id: post }, by.token);
    await http.patch(`post_likes?user_id=eq.${by.id}&feed_event_id=eq.${post}`, { created_at: iso(like.at) });
    tally.add("likes", true);
  }

  const comments = new Set(
    (await http.select<{ user_id: string; feed_event_id: number; body: string }>(
      `post_comments?user_id=${inList(ids)}&deleted_at=is.null&select=user_id,feed_event_id,body`,
    )).map((r) => `${r.user_id}|${r.feed_event_id}|${r.body}`),
  );
  for (const comment of plan.comments) {
    const by = accounts.get(comment.by) as Account;
    const post = postId(comment.post.actor, comment.post.bev.bevId);
    if (comments.has(`${by.id}|${post}|${comment.body}`)) {
      tally.add("comments", false);
      continue;
    }
    const rows = await http.rpc<Array<{ id: number }>>("add_comment", { p_event_id: post, p_body: comment.body }, by.token);
    const id = rows[0]?.id ?? die(`add_comment returned no row for @${comment.by}`);
    await http.patch(`post_comments?id=eq.${id}`, { created_at: iso(comment.at) });
    tally.add("comments", true);
  }
}

// ---------------------------------------------------------------------------
// Verification: what the demo account's screens will get, from the app's RPCs
// ---------------------------------------------------------------------------

type Num = number | string | null;
const num = (v: Num, fallback = 0): number => (v === null || v === undefined ? fallback : Number(v));
const stats = (n: number, mean: Num, sd: Num): Stats => ({ n, mean: num(mean), stddev: num(sd) });

interface SnapshotJson {
  generatedAt: string;
  viewer: { id: string; canSeeAlcohol: boolean; rankingCount: number };
  global: { mean: Num; stddev: Num; byCategoryMean: Record<string, Num> };
  users: Array<[string, number, Num, Num]>;
  categoryStats: Array<[string, string, number, Num, Num]>;
  bevs: Array<[string, string, string | null, string | null, string, number, boolean, string | null, boolean, number, Num, Num, Num, (string | null)?]>;
  rankings: Array<[string, string, Num]>;
}

/**
 * The PredictionSnapshot packages/api/src/snapshot.ts builds, reduced to what
 * `recommend()` reads in its default modes (no stored edges, no stored
 * neighbours, no graph), so Recommended can be checked the way the app
 * computes it. Names come back too, for the printout.
 */
function toSnapshot(json: SnapshotJson): { snapshot: PredictionSnapshot; names: Map<string, string> } {
  const bevs: Record<string, BevFeatures> = {};
  const names = new Map<string, string>();
  for (const [id, name, brand, flavor, categoryId, priceTier, , , isAlcoholic, ratingCount, mean, sd] of json.bevs) {
    bevs[id] = {
      id,
      categoryId: categoryId as BevFeatures["categoryId"],
      brandKey: normaliseBrand(brand),
      flavorTokens: flavorTokens(name, flavor),
      priceTier: priceTier as BevFeatures["priceTier"],
      ratingCount,
      mean: num(mean),
      stddev: num(sd),
      isAlcoholic,
    };
    names.set(id, name);
  }
  const users: Record<string, UserSnapshot> = {};
  for (const [alias, n, mean, sd] of json.users) {
    users[alias] = { id: alias, stats: stats(n, mean, sd), categoryStats: {}, canSeeAlcohol: alias === json.viewer.id && json.viewer.canSeeAlcohol };
  }
  for (const [alias, categoryId, n, mean, sd] of json.categoryStats) {
    const u = users[alias];
    if (u) u.categoryStats[categoryId as BevFeatures["categoryId"]] = stats(n, mean, sd);
  }
  const byCategoryMean: Record<string, number> = {};
  for (const [c, m] of Object.entries(json.global.byCategoryMean)) byCategoryMean[c] = num(m);
  return {
    snapshot: {
      version: RANKING_VERSION,
      generatedAt: json.generatedAt,
      global: { mean: num(json.global.mean), stddev: num(json.global.stddev), byCategoryMean },
      bevs,
      users,
      rankings: json.rankings.map(([userId, bevId, score]) => ({ userId, bevId, score: num(score) })),
    } as PredictionSnapshot,
    names,
  };
}

interface FeedRow {
  id: number;
  actor_handle: string;
  bev_name: string;
  bev_category_id: string;
  score: Num;
  created_at: string;
  like_count: number;
  comment_count: number;
}

async function verify(http: Http, plan: Plan, target: Target): Promise<boolean> {
  const email = `${plan.demoHandle}@${EMAIL_DOMAIN}`;
  const token = await http.signIn(email, target.password);
  if (token === null) die(`cannot sign in as @${plan.demoHandle}: run the seed first`);
  const me = (await http.select<{ id: string }>(`profiles?handle=eq.${plan.demoHandle}&select=id`, token))[0];
  if (!me) die(`@${plan.demoHandle} has no profile`);

  const problems: string[] = [];
  const expect = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };

  console.log(`\nverify: signed in as @${plan.demoHandle}, reading what the app would`);

  // Feed (get_feed: own posts and followees')
  const feed = await http.rpc<FeedRow[]>("get_feed", { p_limit: 20, p_before_id: null }, token);
  const others = feed.filter((f) => f.actor_handle !== plan.demoHandle);
  const likes = feed.reduce((n, f) => n + f.like_count, 0);
  const comments = feed.reduce((n, f) => n + f.comment_count, 0);
  console.log(`  Feed (get_feed, first page of 20): ${feed.length} posts, ${others.length} from people followed, ${likes} likes, ${comments} comments`);
  for (const f of feed.slice(0, 8)) {
    console.log(`    ${f.created_at.slice(0, 16).replace("T", " ")}  @${f.actor_handle.padEnd(16)} ${f.bev_name} (${num(f.score).toFixed(1)})  ${f.like_count} like(s), ${f.comment_count} comment(s)`);
  }
  expect(feed.length >= 10, "the feed's first page has fewer than 10 posts");
  expect(others.length >= 5, "fewer than 5 feed posts are from other people");
  expect(likes > 0 && comments > 0, "no likes or no comments on the feed");

  // Your Lists: the rankings select packages/api's rankings.list makes, as the user
  const lists = await http.select<{ bucket: number; bev_id: string; score: Num }>(`rankings?user_id=eq.${me.id}&select=bucket,bev_id,score&order=bucket.desc,position.asc`, token);
  const wants = await http.select<{ bev_id: string }>(`want_to_try?user_id=eq.${me.id}&select=bev_id`, token);
  const count = (b: number) => lists.filter((l) => l.bucket === b).length;
  console.log(`  Your Lists: Loved ${count(3)}, Fine ${count(2)}, Disliked ${count(1)}; Want to Try ${wants.length}`);
  expect(count(3) > 0 && count(2) > 0 && count(1) > 0, "a bucket in Your Lists is empty");
  expect(wants.length > 0, "Want to Try is empty");

  // Profile
  const st = (await http.rpc<Array<Record<string, Num | boolean>>>("get_profile_stats", { p_user_id: me.id }, token))[0] ?? {};
  console.log(
    `  Profile (get_profile_stats): ${st.bevd_count} Bev'd, ${st.want_count} want, ${st.followers} followers, ${st.following} following, ` +
      `streak ${st.current_streak} (longest ${st.longest_streak}, alive today: ${st.streak_alive_today}), rank ${st.rank_on_bevi}, ${st.rank_points} points`,
  );
  expect(num(st.current_streak as Num) > 0, "the streak is zero");

  // Leaderboards
  const board = await http.rpc<Array<{ name: string; rating_count: number; bayes_score: Num; category_id: string }>>("get_bev_leaderboard", { p_category_id: null, p_limit: 50 }, token);
  console.log(`  Bev leaderboard (get_bev_leaderboard): ${board.length} eligible Bev(s), every one with >= MIN_RATERS (${MIN_RATERS}) raters`);
  for (const b of board.slice(0, 5)) console.log(`    ${b.name} (${b.category_id}): ${num(b.bayes_score).toFixed(2)} from ${b.rating_count} raters`);
  expect(board.length >= 10, "the Bev leaderboard has fewer than 10 rows");
  expect(board.every((b) => b.rating_count >= MIN_RATERS), "a leaderboard row is under MIN_RATERS");
  const friends = await http.rpc<Array<{ handle: string; points: number }>>("get_friends_leaderboard", { p_limit: 50, p_offset: 0 }, token);
  console.log(`  Friends leaderboard (get_friends_leaderboard): ${friends.map((f) => `@${f.handle} ${f.points}`).join(", ")}`);
  expect(friends.length >= 3, "the friends leaderboard has fewer than 3 rows");
  const users = await http.rpc<Array<{ handle: string }>>("get_user_leaderboard", { p_limit: 50 }, token);
  console.log(`  People leaderboard (get_user_leaderboard): ${users.length} row(s)`);

  // Alcohol (IS-3): visible to this account, server-side
  const alcohol = feed.filter((f) => ["beer", "wine", "spirits_cocktails", "hard_seltzer", "cider"].includes(f.bev_category_id)).length;
  console.log(`  Alcohol (IS-3, over 21): ${alcohol} alcoholic post(s) on the first feed page`);

  // Recommended: @bevi/ranking's recommend() over get_prediction_snapshot, as recs.ts does
  const json = await http.rpc<SnapshotJson>("get_prediction_snapshot", {}, token);
  const { snapshot, names } = toSnapshot(json);
  const recs = json.viewer.rankingCount < MIN_N_USER ? [] : recommend(snapshot, json.viewer.id, { n: 20, seed: `${json.viewer.id}:verify` });
  console.log(`  Recommended (recommend() over get_prediction_snapshot): ${recs.length} item(s), viewer has ${json.viewer.rankingCount} rankings (MIN_N_USER ${MIN_N_USER})`);
  for (const r of recs.slice(0, 5)) console.log(`    ${names.get(r.bevId)}: predicted ${r.score.toFixed(1)} (${r.reason})`);
  expect(recs.length > 0, "Recommended is empty");

  // IS-7: a seeded account must never block anyone, or its feed thins out.
  const ids = (await http.select<{ id: string }>(`profiles?handle=${inList(plan.people.map((p) => p.handle))}&select=id`)).map((r) => r.id);
  const blocks = await http.select<{ blocker_id: string }>(`user_blocks?or=(blocker_id.${inList(ids)},blocked_id.${inList(ids)})&select=blocker_id`);
  console.log(`  Blocks touching a seeded person: ${blocks.length}`);
  expect(blocks.length === 0, "a seeded person blocks or is blocked");

  if (problems.length > 0) {
    console.error(`verify: FAILED\n  ${problems.join("\n  ")}`);
    return false;
  }
  console.log("verify: ok");
  return true;
}

// ---------------------------------------------------------------------------

function printPlan(plan: Plan): void {
  const s = plan.summary;
  console.log(
    `  plan: ${s.people} people, ${s.rankings} rankings, ${s.follows} follows, ${s.likes} likes, ${s.comments} comments, ${s.wantToTry} want-to-try; ` +
      `${s.leaderboardEligible} Bev(s) reach MIN_RATERS (${MIN_RATERS}); demo ranks ${s.demoRankings} over a ${s.demoStreakDays}-day streak; ${s.alcoholicBevs} alcoholic Bev(s)`,
  );
}

async function main(argv: readonly string[]): Promise<void> {
  let plan: Plan;
  try {
    plan = buildPlan(new Date());
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }

  if (argv.includes("--dry-run")) {
    console.log("demo:seed: dry run (no credentials read, nothing written)");
    printPlan(plan);
    return;
  }

  const target = resolveTarget(process.env, argv);
  const http = new Http(target.url, target.key);

  if (target.hosted) {
    console.log("demo:seed: ===================== HOSTED PROJECT =====================");
    console.log(`demo:seed: about to write to project ref ${target.ref}`);
    console.log("demo:seed: this is a real database. Ctrl-C now to stop.");
    console.log(`demo:seed: writing in ${HOSTED_WAIT_MS / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, HOSTED_WAIT_MS));
  } else {
    console.log(`demo:seed: target is the LOCAL stack (${target.url})`);
  }

  if (argv.includes("--verify-only")) {
    if (!(await verify(http, plan, target))) process.exit(1);
    return;
  }

  printPlan(plan);
  const tally = new Tally();
  const accounts = await ensureAccounts(http, plan, target, tally);
  await ensureFollows(http, plan, accounts, tally);
  await ensureRankings(http, plan, accounts, tally);
  await ensureWantToTry(http, plan, accounts, tally);
  await ensureReactions(http, plan, accounts, tally);

  console.log("demo:seed: done");
  const written = tally.print();
  console.log(`  ${written} write(s) in total${written === 0 ? ": nothing was missing" : ""}`);
  console.log(`  demo account: @${plan.demoHandle}`);
  if (!target.hosted) {
    console.log(`  local password: ${target.password === LOCAL_PASSWORD ? LOCAL_PASSWORD : "(BEVI_DEMO_PASSWORD)"}`);
    console.log(`  local invite code: ${await readInviteCode(http)}`);
  } else {
    console.log("  password: BEVI_DEMO_PASSWORD; invite code: the app_secrets row (neither is printed for a hosted project)");
  }

  if (!(await verify(http, plan, target))) process.exit(1);
}

main(process.argv.slice(2)).catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
