// Tests for send-push (T-31, Release 2).
//
//   deno test --allow-net --allow-env supabase/functions/send-push/
//
// No network: every PostgREST and Expo call goes to an injected `fetch` that
// answers from a script and records what it was sent, as
// generate-bev-icon/worker.test.ts does.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type ClaimedPush,
  COMMENT_QUOTE_MAX,
  createSender,
  deadReceiptIds,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  likeSentence,
  messagesFor,
  packChunks,
  planPushes,
  readTickets,
  routeFor,
  sentence,
  truncate,
} from './sender.ts';

const SUPABASE = 'https://project.test';
const ENV: Record<string, string> = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
  PUSH_WEBHOOK_SECRET: 'private-webhook',
  PUSH_SENDING_ENABLED: 'true',
};

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';
const D = '00000000-0000-4000-8000-0000000000d4';
const tok = (n: string) => `ExponentPushToken[${n}]`;

function row(over: Partial<ClaimedPush> & Pick<ClaimedPush, 'id' | 'kind'>): ClaimedPush {
  return {
    recipient_id: A,
    tokens: [tok('a')],
    actor_id: B,
    actor_handle: 'ana',
    feed_event_id: over.kind === 'follow' ? null : 900,
    bev_name: over.kind === 'follow' ? null : 'Coke Zero',
    bev_brand: over.kind === 'follow' ? null : 'Coca-Cola',
    bev_flavor: null,
    comment_id: over.kind === 'comment' ? 77 : null,
    comment_body: over.kind === 'comment' ? 'so good' : null,
    badge: 3,
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const trigger = (token: string | null = 'private-webhook', method = 'POST') =>
  new Request('https://fn.test/send-push', {
    method,
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });

interface Call {
  url: string;
  body: unknown;
  headers: Headers;
}

/**
 * A scripted backend. `claims` are handed out one per claim_push_batch call
 * (then []); `send` answers each Expo send request; `receipts` the receipts
 * phase.
 */
function harness(options: {
  env?: Record<string, string | undefined>;
  claims?: ClaimedPush[][];
  send?: (messages: { to: string }[], call: number) => Response | Promise<Response>;
  due?: { ticket_id: string; token: string }[];
  receipts?: (ids: string[]) => Response;
} = {}) {
  const calls: Call[] = [];
  const claims = [...(options.claims ?? [])];
  let sendCalls = 0;
  let dueHandedOut = false;
  const fetchFn: typeof fetch = (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    assert(init?.signal instanceof AbortSignal, 'every request has a timeout');
    if (url === `${SUPABASE}/rest/v1/rpc/claim_push_batch`) return Promise.resolve(json(claims.shift() ?? []));
    if (url === `${SUPABASE}/rest/v1/rpc/claim_push_receipts`) {
      const due = dueHandedOut ? [] : (options.due ?? []);
      dueHandedOut = true;
      return Promise.resolve(json(due));
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/rpc/`)) {
      const b = body as Record<string, unknown[]>;
      const n = (b.p_ids ?? b.p_tickets ?? b.p_tokens ?? b.p_ticket_ids ?? []).length;
      return Promise.resolve(json(n));
    }
    if (url === EXPO_SEND_URL) {
      const messages = body as { to: string }[];
      const call = sendCalls++;
      if (options.send) return Promise.resolve(options.send(messages, call));
      return Promise.resolve(json({ data: messages.map((_, i) => ({ status: 'ok', id: `ticket-${call}-${i}` })) }));
    }
    if (url === EXPO_RECEIPTS_URL) {
      const ids = (body as { ids: string[] }).ids;
      return Promise.resolve(options.receipts ? options.receipts(ids) : json({ data: {} }));
    }
    return Promise.reject(new Error(`unexpected request to ${url}`));
  };
  const env = { ...ENV, ...(options.env ?? {}) };
  const handler = createSender({ env: (name) => env[name], fetch: fetchFn, log: () => {} });
  const rpcs = (fn: string) => calls.filter((c) => c.url === `${SUPABASE}/rest/v1/rpc/${fn}`).map((c) => c.body as Record<string, unknown>);
  const sends = () => calls.filter((c) => c.url === EXPO_SEND_URL);
  return { handler, calls, rpcs, sends };
}

// ---------------------------------------------------------------------------
// Auth, configuration and the kill switch
// ---------------------------------------------------------------------------

Deno.test('a wrong or missing bearer is 401, and nothing is claimed', async () => {
  for (const token of ['wrong', 'private-webhoo', null]) {
    const h = harness({ claims: [[row({ id: 1, kind: 'follow' })]] });
    const res = await h.handler(trigger(token));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthorized' });
    assertEquals(h.calls.length, 0);
  }
});

Deno.test('the service-role key is not the webhook password', async () => {
  const h = harness();
  assertEquals((await h.handler(trigger('private-service-key'))).status, 401);
});

Deno.test('503 not_configured without the secret, the URL or the service key, never falling back', async () => {
  for (const missing of ['PUSH_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const h = harness({ env: { [missing]: undefined } });
    const res = await h.handler(trigger('private-service-key'));
    assertEquals(res.status, 503);
    assertEquals(await res.json(), { error: 'not_configured' });
    assertEquals(h.calls.length, 0);
  }
  const blank = harness({ env: { PUSH_WEBHOOK_SECRET: '' } });
  assertEquals((await blank.handler(trigger(''))).status, 503);
});

Deno.test('only POST', async () => {
  assertEquals((await harness().handler(trigger('private-webhook', 'GET'))).status, 405);
});

Deno.test('PUSH_SENDING_ENABLED must be exactly true: otherwise disabled, and nothing is claimed or sent', async () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const h = harness({ env: { PUSH_SENDING_ENABLED: value }, claims: [[row({ id: 1, kind: 'follow' })]] });
    const res = await h.handler(trigger());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { disabled: true });
    assertEquals(h.calls.length, 0, `nothing at all for ${value}`);
  }
});

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

Deno.test('a follow: "<a> started following you", to their profile', () => {
  const r = row({ id: 1, kind: 'follow' });
  assertEquals(sentence(r), 'ana started following you');
  assertEquals(routeFor(r), `/user/${B}`);
});

Deno.test('a like, a comment, a post: the sentence and the route', () => {
  assertEquals(sentence(row({ id: 1, kind: 'like' })), 'ana liked your Coke Zero');
  assertEquals(routeFor(row({ id: 1, kind: 'like' })), '/post/900');
  assertEquals(sentence(row({ id: 1, kind: 'comment' })), 'ana commented on your Coke Zero: so good');
  assertEquals(routeFor(row({ id: 1, kind: 'comment' })), '/post/900?comments=1');
  assertEquals(sentence(row({ id: 1, kind: 'post' })), "ana Bev'd Coke Zero");
  assertEquals(routeFor(row({ id: 1, kind: 'post' })), '/post/900');
});

Deno.test('the Bev is named as the feed post names it: the name alone, not the brand or the flavor', () => {
  const r = row({ id: 1, kind: 'post', bev_name: 'Cold Brew', bev_brand: 'Stumptown', bev_flavor: 'Original' });
  assertEquals(sentence(r), "ana Bev'd Cold Brew");
});

Deno.test('grouped likes: one, two, three ("1 other") and four ("2 others")', () => {
  assertEquals(likeSentence(['ana'], 'Coke'), 'ana liked your Coke');
  assertEquals(likeSentence(['ana', 'ben'], 'Coke'), 'ana and ben liked your Coke');
  assertEquals(likeSentence(['ana', 'ben', 'cat'], 'Coke'), 'ana, ben and 1 other liked your Coke');
  assertEquals(likeSentence(['ana', 'ben', 'cat', 'dan'], 'Coke'), 'ana, ben and 2 others liked your Coke');
});

Deno.test('likes on one post in one batch are ONE push, newest liker first, settling every row', () => {
  const plans = planPushes([
    row({ id: 10, kind: 'like', actor_id: B, actor_handle: 'ben' }),
    row({ id: 12, kind: 'like', actor_id: C, actor_handle: 'cat' }),
    row({ id: 11, kind: 'follow', actor_id: D, actor_handle: 'dan' }),
    row({ id: 13, kind: 'like', actor_id: D, actor_handle: 'dan' }),
    // Another post's like stays its own push.
    row({ id: 14, kind: 'like', actor_id: B, actor_handle: 'ben', feed_event_id: 901, bev_name: 'Sprite' }),
  ]);
  assertEquals(plans.map((p) => [p.outboxIds, p.body]), [
    [[10, 12, 13], 'dan, cat and 1 other liked your Coke Zero'],
    [[11], 'dan started following you'],
    [[14], 'ben liked your Sprite'],
  ]);
});

Deno.test('a long comment is cut at 140 characters with an ellipsis, on one line, well under 4096 bytes', () => {
  const body = 'line one\nline two '.repeat(40) + '\u{1F600}'.repeat(200);
  const r = row({ id: 1, kind: 'comment', comment_body: body, bev_name: 'B'.repeat(80), actor_handle: 'h'.repeat(20) });
  const text = sentence(r);
  const quote = text.split(': ').slice(1).join(': ');
  assertEquals(Array.from(quote).length, COMMENT_QUOTE_MAX);
  assert(quote.endsWith('…'));
  assert(!text.includes('\n'));
  const [message] = messagesFor(planPushes([r])[0]!);
  assert(new TextEncoder().encode(JSON.stringify(message)).length < 2048);
  // A surrogate pair is never split.
  assertEquals(truncate('\u{1F600}'.repeat(5), 3), '\u{1F600}\u{1F600}…');
});

Deno.test('a message: no title, the body, sound, the badge, the route; one per device', () => {
  const [plan] = planPushes([row({ id: 1, kind: 'follow', tokens: [tok('a'), tok('a2')], badge: 4 })]);
  assertEquals(messagesFor(plan!), [
    { to: tok('a'), body: 'ana started following you', sound: 'default', badge: 4, data: { url: `/user/${B}` } },
    { to: tok('a2'), body: 'ana started following you', sound: 'default', badge: 4, data: { url: `/user/${B}` } },
  ]);
  assert(!('title' in messagesFor(plan!)[0]!));
});

Deno.test('a token that is not an Expo push token never reaches Expo', () => {
  const [plan] = planPushes([row({ id: 1, kind: 'follow', tokens: ['nonsense', tok('a'), tok('a')] })]);
  assertEquals(plan!.tokens, [tok('a')]);
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

Deno.test('send requests hold at most 100 messages, and a push is never split across two', () => {
  const plans = planPushes(
    Array.from({ length: 34 }, (_, i) =>
      row({ id: i + 1, kind: 'follow', recipient_id: `r${i}`, tokens: [tok(`${i}a`), tok(`${i}b`), tok(`${i}c`)] })
    ),
  );
  const chunks = packChunks(plans);
  assertEquals(chunks.map((c) => c.flatMap(messagesFor).length), [99, 3]);
});

Deno.test('150 one-device pushes are two send requests: 100 and 50', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => row({ id: i + 1, kind: 'follow', recipient_id: `r${i}`, tokens: [tok(`t${i}`)] }));
  // Two claims: a full one (100) then the rest (50), as claim_push_batch pages.
  const h = harness({ claims: [rows.slice(0, 100), rows.slice(100)] });
  const res = await h.handler(trigger());
  assertEquals(res.status, 200);
  assertEquals(h.sends().map((c) => (c.body as unknown[]).length), [100, 50]);
  const counts = await res.json();
  assertEquals(counts.claimed, 150);
  assertEquals(counts.sent, 150);
  assertEquals(counts.tickets, 150);
});

Deno.test('Expo gets accept and content-type, and the access token only when one is set', async () => {
  const without = harness({ claims: [[row({ id: 1, kind: 'follow' })]] });
  await without.handler(trigger());
  const plain = without.sends()[0]!.headers;
  assertEquals(plain.get('accept'), 'application/json');
  assertEquals(plain.get('content-type'), 'application/json');
  assertEquals(plain.get('authorization'), null);

  const withToken = harness({ env: { EXPO_ACCESS_TOKEN: 'expo-secret' }, claims: [[row({ id: 1, kind: 'follow' })]] });
  await withToken.handler(trigger());
  assertEquals(withToken.sends()[0]!.headers.get('authorization'), 'Bearer expo-secret');
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

Deno.test('readTickets: ok, DeviceNotRegistered, another error; a malformed answer is null', () => {
  assertEquals(
    readTickets(
      {
        data: [
          { status: 'ok', id: 'x1' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ],
      },
      3,
    ),
    [{ status: 'ok', id: 'x1' }, { status: 'dead' }, { status: 'error', error: 'expo_ticket:MessageTooBig' }],
  );
  assertEquals(readTickets({ data: [] }, 1), null);
  assertEquals(readTickets({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }, 1), null);
});

Deno.test('an ok ticket is recorded and its push finished as sent', async () => {
  const h = harness({ claims: [[row({ id: 5, kind: 'comment' })]] });
  await h.handler(trigger());
  assertEquals(h.rpcs('finish_push_batch'), [{ p_ids: [5], p_error: null }]);
  assertEquals(h.rpcs('record_push_tickets'), [{ p_tickets: [{ ticket_id: 'ticket-0-0', token: tok('a') }] }]);
  assertEquals(h.rpcs('prune_push_tokens'), []);
});

Deno.test('DeviceNotRegistered prunes that token; the push is settled, not retried', async () => {
  const h = harness({
    claims: [[row({ id: 5, kind: 'follow', tokens: [tok('gone')] })]],
    send: () => json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
  });
  await h.handler(trigger());
  assertEquals(h.rpcs('prune_push_tokens'), [{ p_tokens: [tok('gone')] }]);
  assertEquals(h.rpcs('finish_push_batch'), [{ p_ids: [5], p_error: null }]);
});

Deno.test('another error retries the push; one device taking it is enough to count it sent', async () => {
  const h = harness({
    claims: [[
      row({ id: 5, kind: 'follow', tokens: [tok('x')] }),
      row({ id: 6, kind: 'follow', recipient_id: C, tokens: [tok('y1'), tok('y2')] }),
    ]],
    send: () =>
      json({
        data: [
          { status: 'error', details: { error: 'MessageRateExceeded' } },
          { status: 'ok', id: 'y1-ticket' },
          { status: 'error', details: { error: 'MessageRateExceeded' } },
        ],
      }),
  });
  const res = await h.handler(trigger());
  assertEquals(h.rpcs('finish_push_batch'), [
    { p_ids: [6], p_error: null },
    { p_ids: [5], p_error: 'expo_ticket:MessageRateExceeded' },
  ]);
  assertEquals(h.rpcs('record_push_tickets'), [{ p_tickets: [{ ticket_id: 'y1-ticket', token: tok('y1') }] }]);
  const counts = await res.json();
  assertEquals([counts.sent, counts.retried], [1, 1]);
});

Deno.test('a failed send request (non-2xx or unreachable) leaves its whole chunk retryable, and still answers 200', async () => {
  for (const failure of ['status', 'throw'] as const) {
    const h = harness({
      claims: [[row({ id: 1, kind: 'follow' }), row({ id: 2, kind: 'like' }), row({ id: 3, kind: 'like', actor_id: C })]],
      send: () => (failure === 'status' ? json({ internal: 'detail' }, 502) : Promise.reject(new Error('offline'))),
    });
    const res = await h.handler(trigger());
    assertEquals(res.status, 200);
    const finishes = h.rpcs('finish_push_batch');
    assertEquals(finishes.length, 1);
    assertEquals(finishes[0], { p_ids: [1, 2, 3], p_error: failure === 'status' ? 'expo_http_502' : 'expo_unreachable' });
    assertEquals(h.rpcs('record_push_tickets'), []);
    assertEquals((await res.json()).retried, 3);
  }
});

Deno.test('a failed claim is a 500 and sends nothing', async () => {
  const calls: string[] = [];
  const handler = createSender({
    env: (name) => ENV[name],
    log: () => {},
    fetch: (input) => {
      calls.push(String(input));
      return Promise.resolve(json({ message: 'private detail' }, 500));
    },
  });
  const res = await handler(trigger());
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'claim_failed');
  assert(!JSON.stringify(body).includes('private detail'));
  assertEquals(calls, [`${SUPABASE}/rest/v1/rpc/claim_push_batch`]);
});

Deno.test('an empty queue claims once, sends nothing, and checks receipts', async () => {
  const h = harness();
  const res = await h.handler(trigger());
  assertEquals(res.status, 200);
  assertEquals(h.sends().length, 0);
  assertEquals(h.rpcs('claim_push_batch'), [{ p_limit: 100 }]);
  assertEquals(h.rpcs('claim_push_receipts'), [{ p_limit: 1000 }]);
});

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

Deno.test('deadReceiptIds: only DeviceNotRegistered errors', () => {
  assertEquals(
    deadReceiptIds({
      data: {
        r1: { status: 'ok' },
        r2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        r3: { status: 'error', details: { error: 'MessageTooBig' } },
      },
    }),
    ['r2'],
  );
  assertEquals(deadReceiptIds({ errors: [] }), []);
});

Deno.test('the receipts phase asks for the due tickets, prunes dead devices, and marks every one checked', async () => {
  const h = harness({
    due: [
      { ticket_id: 'r1', token: tok('alive') },
      { ticket_id: 'r2', token: tok('gone') },
      { ticket_id: 'r3', token: tok('unknown') },
    ],
    receipts: () => json({ data: { r1: { status: 'ok' }, r2: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }),
  });
  const res = await h.handler(trigger());
  const asked = h.calls.filter((c) => c.url === EXPO_RECEIPTS_URL).map((c) => c.body);
  assertEquals(asked, [{ ids: ['r1', 'r2', 'r3'] }]);
  assertEquals(h.rpcs('prune_push_tokens'), [{ p_tokens: [tok('gone')] }]);
  assertEquals(h.rpcs('finish_push_receipts'), [{ p_ticket_ids: ['r1', 'r2', 'r3'] }]);
  const counts = await res.json();
  assertEquals([counts.pruned, counts.receiptsChecked], [1, 3]);
});

Deno.test('a failed receipts request leaves the tickets unchecked for the next run', async () => {
  const h = harness({ due: [{ ticket_id: 'r1', token: tok('a') }], receipts: () => json({}, 503) });
  const res = await h.handler(trigger());
  assertEquals(res.status, 200);
  assertEquals(h.rpcs('finish_push_receipts'), []);
  assertEquals(h.rpcs('prune_push_tokens'), []);
});

Deno.test('the run stops at the round cap even while every claim comes back full', async () => {
  const full = (base: number) =>
    Array.from({ length: 100 }, (_, i) => row({ id: base + i, kind: 'follow', recipient_id: `r${base + i}` }));
  const h = harness({ claims: Array.from({ length: 9 }, (_, k) => full(k * 100)) });
  await h.handler(trigger());
  assertEquals(h.rpcs('claim_push_batch').length, 5);
});
