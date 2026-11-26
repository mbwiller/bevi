// The send-push worker: message wording, batching, tickets and receipts, and
// the request handler that runs one drain. Everything here is reachable from
// test.ts with an injected `fetch` and env; index.ts is only the Deno.serve
// shell around `createSender`.

export type PushKind = 'follow' | 'like' | 'comment' | 'post';

/** One row of `claim_push_batch()` (20261127000100, section 6a). */
export interface ClaimedPush {
  id: number;
  kind: PushKind;
  recipient_id: string;
  /** Every device of the recipient, most recently seen first; never empty (the claim skips 'no tokens'). */
  tokens: string[];
  actor_id: string;
  actor_handle: string | null;
  feed_event_id: number | null;
  bev_name: string | null;
  bev_brand: string | null;
  bev_flavor: string | null;
  comment_id: number | null;
  comment_body: string | null;
  /** The recipient's unread displayed inbox rows, as the app's badge shows them. */
  badge: number;
}

/** One push as the recipient sees it, and the outbox rows it settles. */
export interface PlannedPush {
  outboxIds: number[];
  tokens: string[];
  body: string;
  badge: number;
  url: string;
}

/**
 * One Expo message: one device. NO `title`, so iOS shows the app's name above
 * the sentence. One message per token keeps every ticket tied to exactly one
 * device, which is what a DeviceNotRegistered answer needs.
 */
export interface ExpoMessage {
  to: string;
  body: string;
  sound: 'default';
  badge: number;
  data: { url: string };
}

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo's caps: 100 messages per send request, 1000 ids per receipts request. */
export const SEND_CHUNK = 100;
export const RECEIPT_CHUNK = 1000;
/** Rows per claim; a full batch means there may be more, so the run loops. */
export const CLAIM_LIMIT = 100;
/** Hard caps on one invocation, far inside the five-minute lease and the platform's wall clock. */
export const MAX_ROUNDS = 5;
export const MAX_WALL_MS = 60_000;
/** A comment is quoted up to this many characters; a Bev name and a handle are short by their checks. */
export const COMMENT_QUOTE_MAX = 140;
const NAME_MAX = 80;
const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[!-~]{1,180}\]$/;

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** Whitespace (newlines included) collapsed to single spaces, trimmed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** At most `max` code points, the last one an ellipsis when cut; never splits a surrogate pair. */
export function truncate(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  return points.slice(0, Math.max(max - 1, 0)).join('').trimEnd() + '…';
}

/**
 * How a post names its Bev. Mirrors app/src/components/FeedPost.tsx, which
 * app/src/features/feed/FeedPostItem.tsx renders for every feed post: its
 * headline is "{who} Bev'd {bev.name}" -- the name alone; the brand sits on the
 * meta line under it, and the flavor is not shown. So the push says the name
 * too. `bev_brand` and `bev_flavor` arrive (they are get_feed's fields) but
 * are not part of the sentence, exactly as on the screen.
 */
export function bevDisplayName(row: Pick<ClaimedPush, 'bev_name' | 'bev_brand' | 'bev_flavor'>): string | null {
  const name = oneLine(row.bev_name ?? '');
  return name ? truncate(name, NAME_MAX) : null;
}

function handleOf(row: Pick<ClaimedPush, 'actor_handle'>): string {
  const handle = oneLine(row.actor_handle ?? '');
  return handle ? truncate(handle, NAME_MAX) : 'Someone';
}

/** "a liked your X", "a and b liked your X", "a, b and 1 other liked your X", "a, b and 3 others ...". */
export function likeSentence(handles: readonly string[], bev: string | null): string {
  const what = `your ${bev ?? 'post'}`;
  const [a, b] = handles;
  if (handles.length <= 1) return `${a ?? 'Someone'} liked ${what}`;
  if (handles.length === 2) return `${a} and ${b} liked ${what}`;
  const rest = handles.length - 2;
  return `${a}, ${b} and ${rest} ${rest === 1 ? 'other' : 'others'} liked ${what}`;
}

/** The sentence for one row of a kind other than a grouped like. Sentence case, no emoji, no full stop. */
export function sentence(row: ClaimedPush): string {
  const who = handleOf(row);
  const bev = bevDisplayName(row);
  switch (row.kind) {
    case 'follow':
      return `${who} started following you`;
    case 'like':
      return likeSentence([who], bev);
    case 'comment': {
      const quote = truncate(oneLine(row.comment_body ?? ''), COMMENT_QUOTE_MAX);
      const head = `${who} commented on your ${bev ?? 'post'}`;
      return quote ? `${head}: ${quote}` : head;
    }
    case 'post':
      return `${who} Bev'd ${bev ?? 'a Bev'}`;
    default:
      // Unreachable: push_outbox's check allows the four kinds above.
      return `${who} has something new for you`;
  }
}

/** The in-app route the push opens (`data.url`). */
export function routeFor(row: Pick<ClaimedPush, 'kind' | 'actor_id' | 'feed_event_id'>): string {
  switch (row.kind) {
    case 'follow':
      return `/user/${row.actor_id}`;
    case 'comment':
      return `/post/${row.feed_event_id}?comments=1`;
    case 'like':
    case 'post':
      return `/post/${row.feed_event_id}`;
    default:
      return '/';
  }
}

/**
 * The claimed rows as pushes. Every like on one post for one recipient in this
 * batch is ONE push, newest liker first, and settles all of their rows; every
 * other row is a push of its own. Tokens that are not Expo push tokens are
 * dropped (the table's check makes that unreachable; this keeps a bad row from
 * reaching Expo at all).
 *
 * A row that cannot be worded (a value of the wrong type, whatever throws)
 * never takes its batch down: it, or its like group, lands in `failedIds`, to
 * be finished with an error, and every other row is planned as usual.
 */
export function planBatch(rows: readonly ClaimedPush[]): { plans: PlannedPush[]; failedIds: number[] } {
  const plans: { first: number; plan: PlannedPush }[] = [];
  const failedIds: number[] = [];
  const likeGroups = new Map<string, ClaimedPush[]>();
  for (const row of rows) {
    try {
      if (row.kind === 'like' && row.feed_event_id !== null) {
        const key = `${row.recipient_id}:${row.feed_event_id}`;
        const group = likeGroups.get(key);
        if (group) group.push(row);
        else likeGroups.set(key, [row]);
        continue;
      }
      plans.push({
        first: row.id,
        plan: { outboxIds: [row.id], tokens: validTokens(row.tokens), body: sentence(row), badge: badgeOf(row), url: routeFor(row) },
      });
    } catch {
      if (typeof row?.id === 'number') failedIds.push(row.id);
    }
  }
  for (const group of likeGroups.values()) {
    try {
      const newestFirst = [...group].sort((x, y) => y.id - x.id);
      const handles: string[] = [];
      const seen = new Set<string>();
      for (const row of newestFirst) {
        if (seen.has(row.actor_id)) continue;
        seen.add(row.actor_id);
        handles.push(handleOf(row));
      }
      const head = newestFirst[0]!;
      plans.push({
        first: Math.min(...group.map((r) => r.id)),
        plan: {
          outboxIds: group.map((r) => r.id).sort((x, y) => x - y),
          tokens: validTokens(head.tokens),
          body: likeSentence(handles, bevDisplayName(head)),
          badge: Math.max(...group.map(badgeOf)),
          url: routeFor(head),
        },
      });
    } catch {
      failedIds.push(...group.map((r) => r.id));
    }
  }
  return { plans: plans.sort((x, y) => x.first - y.first).map((p) => p.plan), failedIds };
}

/** `planBatch`'s pushes alone. */
export function planPushes(rows: readonly ClaimedPush[]): PlannedPush[] {
  return planBatch(rows).plans;
}

function validTokens(tokens: readonly string[] | null): string[] {
  return [...new Set((tokens ?? []).filter((t) => typeof t === 'string' && t.length <= 200 && PUSH_TOKEN_RE.test(t)))];
}

function badgeOf(row: Pick<ClaimedPush, 'badge'>): number {
  const n = Number(row.badge);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function messagesFor(plan: PlannedPush): ExpoMessage[] {
  return plan.tokens.map((to): ExpoMessage => ({ to, body: plan.body, sound: 'default', badge: plan.badge, data: { url: plan.url } }));
}

/**
 * Pushes packed into send requests of at most `size` messages, a push never
 * split across two (a recipient has at most ten devices), so one request's
 * failure retries whole pushes and never half of one.
 */
export function packChunks(plans: readonly PlannedPush[], size = SEND_CHUNK): PlannedPush[][] {
  const chunks: PlannedPush[][] = [];
  let current: PlannedPush[] = [];
  let count = 0;
  for (const plan of plans) {
    const n = Math.min(plan.tokens.length, size);
    if (count + n > size && current.length > 0) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(n === plan.tokens.length ? plan : { ...plan, tokens: plan.tokens.slice(0, size) });
    count += n;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Tickets and receipts
// ---------------------------------------------------------------------------

export type TicketOutcome =
  | { status: 'ok'; id: string }
  | { status: 'dead' }
  | { status: 'error'; error: string };

function isDeviceNotRegistered(value: unknown): boolean {
  const details = (value as { details?: { error?: unknown } } | null)?.details;
  return details?.error === 'DeviceNotRegistered';
}

/**
 * Expo's answer to one send request, one outcome per message in order, or
 * null when the answer is not that (a request-level `errors`, a wrong length):
 * then the whole request counts as failed.
 */
export function readTickets(body: unknown, expected: number): TicketOutcome[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== expected) return null;
  return data.map((ticket): TicketOutcome => {
    const t = ticket as { status?: unknown; id?: unknown; message?: unknown } | null;
    if (t?.status === 'ok' && typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 200) {
      return { status: 'ok', id: t.id };
    }
    if (t?.status === 'error' && isDeviceNotRegistered(t)) return { status: 'dead' };
    const code = (t as { details?: { error?: unknown } } | null)?.details?.error;
    return { status: 'error', error: `expo_ticket:${typeof code === 'string' ? code : 'error'}`.slice(0, 200) };
  });
}

/** The ids whose receipt says the device is gone. Missing or 'ok' receipts are not. */
export function deadReceiptIds(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .filter(([, receipt]) => (receipt as { status?: unknown } | null)?.status === 'error' && isDeviceNotRegistered(receipt))
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export interface SenderDependencies {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
  log?: (event: Record<string, unknown>) => void;
  /** Milliseconds, for the wall-clock cap. */
  now?: () => number;
}

export interface RunCounts {
  claimed: number;
  sent: number;
  retried: number;
  pruned: number;
  tickets: number;
  receiptsChecked: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Constant-time comparison of SHA-256 digests (generate-bev-icon/worker.ts):
 * digests are always 32 bytes, so there is no early return on length.
 */
async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function bearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Read an untrusted body with a real byte cap, then parse it; null when it is not JSON or too big. */
async function readJson(res: Response, limit: number): Promise<unknown> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel();
    return null;
  }
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function createSender(deps: SenderDependencies): (req: Request) => Promise<Response> {
  const rawFetch = deps.fetch ?? fetch;
  const request: typeof fetch = (url, init) => rawFetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const now = deps.now ?? (() => Date.now());

  return async (req) => {
    try {
      return await handle(req);
    } catch {
      log({ fn: 'send-push', event: 'request_failed' });
      return json({ error: 'send_request_failed' }, 503);
    }
  };

  async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const supabaseUrl = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = deps.env('PUSH_WEBHOOK_SECRET') || undefined;
    // 401 before anything about the configuration: a caller without the
    // secret learns nothing. With no secret configured at all there is nothing
    // to match, so a call that carries a bearer is told so (503); one with no
    // bearer is still just unauthorized.
    const presented = bearer(req);
    if (!presented) return json({ error: 'unauthorized' }, 401);
    if (!webhookSecret) return json({ error: 'not_configured' }, 503);
    if (!(await tokensMatch(presented, webhookSecret))) return json({ error: 'unauthorized' }, 401);
    if (!supabaseUrl || !serviceKey) return json({ error: 'not_configured' }, 503);
    // Deployed and configured is not enabled: only the literal `true` sends.
    if (deps.env('PUSH_SENDING_ENABLED') !== 'true') return json({ disabled: true }, 200);

    const expoToken = deps.env('EXPO_ACCESS_TOKEN') || undefined;
    const started = now();
    const counts: RunCounts = { claimed: 0, sent: 0, retried: 0, pruned: 0, tickets: 0, receiptsChecked: 0 };

    // PostgREST as the service role. The response body of a failed call is
    // never returned or logged: it carries schema and constraint names, and
    // pg_net keeps this function's response in `net._http_response`.
    const rpc = async (fn: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> => {
      const res = await request(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, status: res.status, data: null };
      }
      return { ok: true, status: res.status, data: await readJson(res, 4 * 1024 * 1024) };
    };
    const reported = async (fn: string, body: unknown) => {
      try {
        const r = await rpc(fn, body);
        if (!r.ok) log({ fn: 'send-push', event: 'report_failed', rpc: fn, status: r.status });
        return r.ok ? Number(r.data) || 0 : 0;
      } catch {
        log({ fn: 'send-push', event: 'report_failed', rpc: fn });
        return 0;
      }
    };
    const expo = async (url: string, payload: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> => {
      const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
      if (expoToken) headers.Authorization = `Bearer ${expoToken}`;
      let res: Response;
      try {
        res = await request(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      } catch {
        return { ok: false, error: 'expo_unreachable' };
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, error: `expo_http_${res.status}` };
      }
      return { ok: true, body: await readJson(res, 1024 * 1024) };
    };
    const inTime = () => now() - started < MAX_WALL_MS;

    // ---- 1. Sending -------------------------------------------------------
    for (let round = 0; round < MAX_ROUNDS && inTime(); round++) {
      const claim = await rpc('claim_push_batch', { p_limit: CLAIM_LIMIT });
      if (!claim.ok) {
        log({ fn: 'send-push', event: 'claim_failed', status: claim.status });
        return json({ error: 'claim_failed', status: claim.status, ...counts }, 500);
      }
      if (!Array.isArray(claim.data)) return json({ error: 'invalid_claim_response', ...counts }, 503);
      const rows = claim.data as ClaimedPush[];
      counts.claimed += rows.length;
      if (rows.length === 0) break;

      const sentIds: number[] = [];
      const retry = new Map<string, number[]>();
      const tickets: { ticket_id: string; token: string }[] = [];
      const dead = new Set<string>();
      const { plans, failedIds } = planBatch(rows);
      // A row that could not be worded is failed on its own; the lease counted
      // the attempt, so after five claims it is finished as 'skipped: attempts'.
      if (failedIds.length > 0) {
        log({ fn: 'send-push', event: 'plan_failed', rows: failedIds.length });
        retry.set('plan_failed', [...failedIds]);
      }
      // A push left with no device to send to has nothing to retry.
      for (const plan of plans) if (plan.tokens.length === 0) sentIds.push(...plan.outboxIds);

      for (const chunk of packChunks(plans.filter((p) => p.tokens.length > 0))) {
        const messages = chunk.flatMap(messagesFor);
        const answer = await expo(EXPO_SEND_URL, messages);
        const outcomes = answer.ok ? readTickets(answer.body, messages.length) : null;
        if (!outcomes) {
          // The whole request failed: every push in it goes back to the queue.
          const error = answer.ok ? 'expo_bad_response' : answer.error;
          for (const plan of chunk) retry.set(error, [...(retry.get(error) ?? []), ...plan.outboxIds]);
          continue;
        }
        let i = 0;
        for (const plan of chunk) {
          let delivered = false;
          let failure: string | null = null;
          for (const token of plan.tokens) {
            const outcome = outcomes[i++]!;
            if (outcome.status === 'ok') {
              delivered = true;
              tickets.push({ ticket_id: outcome.id, token });
            } else if (outcome.status === 'dead') {
              dead.add(token);
            } else {
              failure ??= outcome.error;
            }
          }
          // Sent once any device took it (retrying would repeat it on that
          // device), and settled when every device is gone; retried only when
          // no device took it and at least one failed for another reason.
          if (delivered || failure === null) sentIds.push(...plan.outboxIds);
          else retry.set(failure, [...(retry.get(failure) ?? []), ...plan.outboxIds]);
        }
      }

      if (sentIds.length > 0) counts.sent += await reported('finish_push_batch', { p_ids: sentIds, p_error: null });
      for (const [error, ids] of retry) {
        counts.retried += await reported('finish_push_batch', { p_ids: ids, p_error: error });
      }
      if (tickets.length > 0) counts.tickets += await reported('record_push_tickets', { p_tickets: tickets });
      if (dead.size > 0) counts.pruned += await reported('prune_push_tokens', { p_tokens: [...dead] });

      if (rows.length < CLAIM_LIMIT) break;
    }

    // ---- 2. Receipts ------------------------------------------------------
    for (let round = 0; round < MAX_ROUNDS && inTime(); round++) {
      const due = await rpc('claim_push_receipts', { p_limit: RECEIPT_CHUNK });
      if (!due.ok || !Array.isArray(due.data)) {
        log({ fn: 'send-push', event: 'receipts_claim_failed', status: due.status });
        break;
      }
      const rows = due.data as { ticket_id: string; token: string }[];
      if (rows.length === 0) break;
      const answer = await expo(EXPO_RECEIPTS_URL, { ids: rows.map((r) => r.ticket_id) });
      // A failed fetch leaves them unchecked for the next run (claim_push_receipts
      // stops offering a ticket after a day).
      if (!answer.ok) {
        log({ fn: 'send-push', event: 'receipts_failed', error: answer.error });
        break;
      }
      const tokenOf = new Map(rows.map((r) => [r.ticket_id, r.token]));
      const deadTokens = [...new Set(deadReceiptIds(answer.body).flatMap((id) => tokenOf.get(id) ?? []))];
      if (deadTokens.length > 0) counts.pruned += await reported('prune_push_tokens', { p_tokens: deadTokens });
      // Every id asked about is checked, a missing receipt included: Expo has
      // had its fifteen minutes, and the next push to that device gets a
      // ticket of its own.
      counts.receiptsChecked += await reported('finish_push_receipts', { p_ticket_ids: rows.map((r) => r.ticket_id) });
      if (rows.length < RECEIPT_CHUNK) break;
    }

    log({ fn: 'send-push', event: 'invocation_finished', ...counts, ms: Math.round(now() - started) });
    return json(counts, 200);
  }
}
