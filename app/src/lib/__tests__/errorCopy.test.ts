import { ApiError, type ApiErrorCode } from '@bevi/shared';

import { errorCopy } from '../errorCopy';

const CODES: ApiErrorCode[] = ['unauthorized', 'not_found', 'conflict', 'validation', 'rate_limited', 'age_restricted', 'network', 'unknown'];

it('maps network to the offline copy with wifi-off and Retry', () => {
  expect(errorCopy(new ApiError('network', 'fetch failed'))).toEqual({
    title: "You're offline",
    message: "We'll show this again as soon as you're back online.",
    icon: 'wifi-off',
    retry: true,
  });
});

it('has copy for every code, without apologies or codes', () => {
  for (const code of CODES) {
    const c = errorCopy(new ApiError(code, 'x'));
    expect(c.title).toBeTruthy();
    expect(c.message).toBeTruthy();
    expect(`${c.title} ${c.message}`).not.toMatch(/sorry|apolog|oops|error|_/i);
  }
});

it('offers Retry only where retrying can help', () => {
  expect(errorCopy(new ApiError('unauthorized', 'x')).retry).toBe(false);
  expect(errorCopy(new ApiError('not_found', 'x')).retry).toBe(false);
  expect(errorCopy(new ApiError('age_restricted', 'x')).title).toBe('Not available');
  expect(errorCopy(new ApiError('conflict', 'x')).retry).toBe(true);
});

it('treats anything else as unknown', () => {
  const unknown = errorCopy(new ApiError('unknown', 'x'));
  expect(errorCopy(new Error('boom'))).toEqual(unknown);
  expect(errorCopy('nope')).toEqual(unknown);
  expect(errorCopy(undefined)).toEqual(unknown);
  expect(unknown.title).toBe("Couldn't load this");
});
