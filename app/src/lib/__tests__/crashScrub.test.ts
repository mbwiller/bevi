import { ApiError, type ApiErrorCode } from '@bevi/shared';

import { isExpectedError, REDACTED, scrubBreadcrumb, scrubEvent, scrubText, scrubValue, stripQuery } from '../crashScrub';

// Made-up values in the real shapes: a signed Storage URL, a session JWT, a publishable key.
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWJ5dGVz';
const SIGNED_URL = `https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg?token=${JWT}`;
const KEY = 'sb_publishable_AbCdEf123456';

/** Nothing that could be a credential is left anywhere in what would be sent. */
function expectClean(value: unknown): void {
  const sent = JSON.stringify(value);
  expect(sent).not.toContain('eyJ');
  expect(sent).not.toContain('token=');
  expect(sent).not.toContain(KEY);
  expect(sent).not.toContain('?');
}

describe('stripQuery', () => {
  it('cuts a URL at its query string or its fragment, absolute or not', () => {
    expect(stripQuery(SIGNED_URL)).toBe('https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg');
    expect(stripQuery('/rest/v1/bevs?select=*&id=eq.7')).toBe('/rest/v1/bevs');
    expect(stripQuery('bevi://auth#access_token=abc')).toBe('bevi://auth');
    expect(stripQuery('https://ref.supabase.co/rest/v1/bevs')).toBe('https://ref.supabase.co/rest/v1/bevs');
  });
});

describe('scrubText', () => {
  it('removes the query string of every URL in a message', () => {
    expect(scrubText(`Failed to load ${SIGNED_URL} (403) and ${SIGNED_URL}`)).toBe(
      'Failed to load https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg (403) and https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg',
    );
  });

  it('replaces a JWT, a Bearer value and a Supabase key wherever they stand', () => {
    expect(scrubText(`session ${JWT} expired`)).toBe(`session ${REDACTED} expired`);
    expect(scrubText(`Authorization: Bearer ${JWT}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(scrubText('Authorization: bearer opaque-token_123')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(scrubText(`apikey ${KEY} refused`)).toBe(`apikey ${REDACTED} refused`);
    expect(scrubText('sb_secret_Zz99 leaked')).toBe(`${REDACTED} leaked`);
  });

  it('replaces the value of a credential parameter in a URL that is not absolute', () => {
    expect(scrubText('GET /object/sign/a.jpg?token=abc123&width=200')).toBe(`GET /object/sign/a.jpg?token=${REDACTED}&width=200`);
    expect(scrubText('refresh_token=r1&password=hunter2&apikey=k')).toBe(`refresh_token=${REDACTED}&password=${REDACTED}&apikey=${REDACTED}`);
  });

  it('leaves ordinary text alone', () => {
    const text = 'TypeError: undefined is not a function (near "...rankings.map...") at BevRow (src/components/BevRow.tsx:41)';
    expect(scrubText(text)).toBe(text);
  });
});

describe('scrubValue', () => {
  it('replaces the value under any key that names a credential', () => {
    const headers = { Authorization: 'anything', apikey: KEY, 'X-Api-Key': 'k', Cookie: 'sb=1', 'Content-Type': 'application/json' };
    expect(scrubValue({ headers })).toEqual({
      headers: { Authorization: REDACTED, apikey: REDACTED, 'X-Api-Key': REDACTED, Cookie: REDACTED, 'Content-Type': 'application/json' },
    });
    expect(scrubValue({ access_token: 'a', refreshToken: 'b', password: 'c', client_secret: 'd', signature: 'e' })).toEqual({
      access_token: REDACTED,
      refreshToken: REDACTED,
      password: REDACTED,
      client_secret: REDACTED,
      signature: REDACTED,
    });
  });

  it("drops a key that holds a URL's query string or fragment by itself", () => {
    // How a request log can record a request: the URL without its query, and the query beside it.
    expect(scrubValue({ url: 'https://ref.supabase.co/a.jpg', 'http.query': `token=${JWT}`, 'http.fragment': 'x', method: 'GET' })).toEqual({
      url: 'https://ref.supabase.co/a.jpg',
      method: 'GET',
    });
    expect(scrubValue({ query_string: 'a=1', search: '?a=1', hash: '#b' })).toEqual({});
  });

  it('cuts the query off a URL field even when the URL is relative', () => {
    expect(scrubValue({ url: '/storage/v1/object/sign/a.jpg?token=abc', to: '/image/x?u=1', from: '/feed' })).toEqual({
      url: '/storage/v1/object/sign/a.jpg',
      to: '/image/x',
      from: '/feed',
    });
  });

  it('follows nested objects and arrays, and never changes what it was given', () => {
    const given = { requests: [{ url: SIGNED_URL, headers: { authorization: `Bearer ${JWT}` } }], note: `key ${KEY}`, count: 3, ok: true, none: null };
    const copy = JSON.parse(JSON.stringify(given)) as typeof given;
    const out = scrubValue(given);
    expect(out).toEqual({
      requests: [{ url: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg', headers: { authorization: REDACTED } }],
      note: `key ${REDACTED}`,
      count: 3,
      ok: true,
      none: null,
    });
    expectClean(out);
    expect(given).toEqual(copy);
  });

  it('turns an Error into its scrubbed name and message, keeps a Date, and names any other instance instead of sending it', () => {
    const when = new Date(0);
    const out = scrubValue({ arguments: [new TypeError(`fetch ${SIGNED_URL} failed`), when, new Map([['token', JWT]])] });
    expect(out).toEqual({
      arguments: ['TypeError: fetch https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg failed', when, '[object Map]'],
    });
    expectClean(out);
  });

  it('stops at a depth, replacing what is deeper instead of sending it unread', () => {
    let deep: Record<string, unknown> = { token: JWT };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expectClean(scrubValue(deep));
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs a request breadcrumb and keeps what says which request it was', () => {
    const breadcrumb = { type: 'http', category: 'fetch', timestamp: 1, data: { method: 'GET', url: SIGNED_URL, status_code: 403 } };
    expect(scrubBreadcrumb(breadcrumb)).toEqual({
      type: 'http',
      category: 'fetch',
      timestamp: 1,
      data: { method: 'GET', url: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg', status_code: 403 },
    });
    // The breadcrumb the SDK handed over is not the one changed.
    expect(breadcrumb.data.url).toBe(SIGNED_URL);
  });

  it('scrubs a console breadcrumb', () => {
    const out = scrubBreadcrumb({ category: 'console', level: 'warning', message: `refresh failed for ${JWT}`, data: { arguments: [`Bearer ${JWT}`] } });
    expect(out.message).toBe(`refresh failed for ${REDACTED}`);
    expectClean(out);
    expect(out.level).toBe('warning');
  });
});

describe('scrubEvent', () => {
  it('scrubs the message, exception messages, breadcrumbs, request, extra, contexts and tags', () => {
    const frames = [{ filename: 'app:///main.jsbundle', function: 'BevRow', lineno: 1, colno: 2 }];
    const event = {
      event_id: 'abc',
      message: `GET ${SIGNED_URL}`,
      exception: { values: [{ type: 'Error', value: `Request failed: ${SIGNED_URL}`, stacktrace: { frames } }] },
      breadcrumbs: [
        { type: 'http', data: { url: SIGNED_URL } },
        // One that never went through `scrubBreadcrumb`, with the query beside the URL.
        { type: 'http', data: { url: 'https://ref.supabase.co/a.jpg', 'http.query': `token=${JWT}` } },
      ],
      request: { url: SIGNED_URL, headers: { Authorization: `Bearer ${JWT}`, apikey: KEY }, query_string: `token=${JWT}` },
      extra: { read: 'bevs', last: SIGNED_URL },
      contexts: { device: { model: 'iPhone15,2' }, response: { headers: { 'set-cookie': 'sb=1' } } },
      tags: { source: 'query', link: SIGNED_URL },
    };
    const out = scrubEvent(event);
    expectClean(out);
    expect(out.event_id).toBe('abc');
    expect(out.exception.values[0]).toEqual({
      type: 'Error',
      value: 'Request failed: https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg',
      stacktrace: { frames },
    });
    expect(out.breadcrumbs[1]).toEqual({ type: 'http', data: { url: 'https://ref.supabase.co/a.jpg' } });
    expect(out.request).toEqual({
      url: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg',
      headers: { Authorization: REDACTED, apikey: REDACTED },
    });
    expect(out.extra).toEqual({ read: 'bevs', last: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg' });
    expect(out.contexts).toEqual({ device: { model: 'iPhone15,2' }, response: { headers: { 'set-cookie': REDACTED } } });
    expect(out.tags).toEqual({ source: 'query', link: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg' });
  });

  it('passes an event with none of those through', () => {
    const event: { event_id: string; level: string; platform: string; message?: string } = { event_id: 'abc', level: 'fatal', platform: 'javascript' };
    expect(scrubEvent(event)).toEqual(event);
  });
});

describe('isExpectedError', () => {
  const EXPECTED: ApiErrorCode[] = ['network', 'unauthorized', 'validation', 'not_found', 'rate_limited', 'conflict', 'age_restricted'];

  it.each(EXPECTED)('an ApiError with the code %s is expected', (code) => {
    expect(isExpectedError(new ApiError(code, 'x'))).toBe(true);
  });

  it('an ApiError with the code unknown is not', () => {
    expect(isExpectedError(new ApiError('unknown', 'add_comment returned no row'))).toBe(false);
  });

  it('nor is anything that is not an ApiError', () => {
    expect(isExpectedError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isExpectedError('a string')).toBe(false);
    expect(isExpectedError(undefined)).toBe(false);
    // The shape is not enough: the contract's class is what the app throws.
    expect(isExpectedError({ name: 'ApiError', code: 'network' })).toBe(false);
  });
});
