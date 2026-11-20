import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ApiError, type ApiErrorCode } from '@bevi/shared';

import { captureError, setCrashSink, type CrashReport } from '../crashReporting';
import { REDACTED } from '../crashScrub';

// The seam between the app and whatever reports crashes (nothing does yet). What is under test is
// what holds for any reporter: what is handed over, what never is, and that handing over cannot fail.

// Made-up values in the real shapes: a session JWT inside a signed Storage URL.
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWJ5dGVz';
const SIGNED_URL = `https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg?token=${JWT}`;

const sink = jest.fn<void, [CrashReport]>();
/** The one report the sink was handed. */
function report(): CrashReport {
  expect(sink).toHaveBeenCalledTimes(1);
  return sink.mock.calls[0]![0];
}

let consoleSpies: jest.SpyInstance[];

beforeEach(() => {
  sink.mockReset();
  setCrashSink(null);
  consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  setCrashSink(null);
  consoleSpies.forEach((spy) => spy.mockRestore());
});

/** Nothing was written to the console at any level. */
const expectSilent = () => consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

describe('with no sink registered', () => {
  it('does nothing, and does not throw, whatever it is given', () => {
    for (const thrown of [new Error('boom'), new ApiError('unknown', 'x'), new ApiError('network', 'x'), 'a string', 42, null, undefined, { odd: true }]) {
      expect(() => captureError(thrown, { source: 'query', extra: { read: 'bevs' } })).not.toThrow();
    }
    expect(sink).not.toHaveBeenCalled();
    expectSilent();
  });

  it('does not even read the error', () => {
    const error = new Error('boom');
    const read = jest.fn(() => 'stack');
    Object.defineProperty(error, 'stack', { get: read });
    Object.defineProperty(error, 'message', { get: read });
    captureError(error, { source: 'render' });
    expect(read).not.toHaveBeenCalled();
  });

  it('is what removing a sink goes back to', () => {
    setCrashSink(sink);
    setCrashSink(null);
    captureError(new Error('boom'));
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('with a sink registered', () => {
  beforeEach(() => setCrashSink(sink));

  it('hands over a plain report: name, message, stack, where it was caught and the facts passed', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'map')");
    captureError(error, { source: 'query', extra: { read: 'bevs', page: 2, cached: false } });
    expect(report()).toEqual({
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'map')",
      stack: expect.stringContaining('crashReporting.test.ts'),
      source: 'query',
      extra: { read: 'bevs', page: 2, cached: false },
    });
    // Plain data: it survives being stored or sent as it is, and the error object is not in it.
    expect(JSON.parse(JSON.stringify(report()))).toEqual(report());
    expect(Object.values(report())).not.toContain(error);
    expectSilent();
  });

  it('leaves out what it was not given', () => {
    const error = new Error('boom');
    captureError(error);
    expect(Object.keys(report()).sort()).toEqual(['message', 'name', 'stack']);
  });

  it('scrubs the message, the stack and the facts before the sink sees them', () => {
    const error = new Error(`Failed to load ${SIGNED_URL} with Bearer ${JWT}`);
    error.stack = `Error: Failed to load ${SIGNED_URL}\n    at load (app:///main.jsbundle:1:2345)`;
    captureError(error, { source: 'query', extra: { last: SIGNED_URL, apikey: 'sb_publishable_AbCdEf123456' } });
    const sent = JSON.stringify(report());
    expect(sent).not.toContain('eyJ');
    expect(sent).not.toContain('token=');
    expect(sent).not.toContain('sb_publishable_');
    expect(report()).toEqual({
      name: 'Error',
      message: `Failed to load https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg with Bearer ${REDACTED}`,
      stack: 'Error: Failed to load https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg\n    at load (app:///main.jsbundle:1:2345)',
      source: 'query',
      extra: { last: 'https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg', apikey: REDACTED },
    });
  });

  const EXPECTED: ApiErrorCode[] = ['network', 'unauthorized', 'validation', 'not_found', 'rate_limited', 'conflict', 'age_restricted'];

  it.each(EXPECTED)('never hands over an ApiError the app expects (%s)', (code) => {
    captureError(new ApiError(code, 'expected'), { source: 'query' });
    expect(sink).not.toHaveBeenCalled();
  });

  it('hands over an ApiError the contract has no name for, with its code and without its detail', () => {
    captureError(new ApiError('unknown', 'add_comment returned no row', { body: 'what the person typed' }), { source: 'mutation' });
    expect(report()).toMatchObject({ name: 'ApiError', message: 'add_comment returned no row', source: 'mutation', apiCode: 'unknown' });
    expect(JSON.stringify(report())).not.toContain('what the person typed');
    expect(report()).not.toHaveProperty('detail');
  });

  it('hands over what is thrown even when it is not an Error, without reading into it', () => {
    captureError(`timeout loading ${SIGNED_URL}`);
    expect(report()).toEqual({ name: 'NonError', message: 'timeout loading https://ref.supabase.co/storage/v1/object/sign/bev-photos/a/b.jpg' });
    sink.mockReset();
    captureError({ token: JWT, note: 'what the person typed' }, { source: 'render' });
    expect(report()).toEqual({ name: 'NonError', message: '[object Object]', source: 'render' });
  });

  it('a sink that throws is swallowed: reporting an error never raises one', () => {
    sink.mockImplementation(() => {
      throw new Error('the reporter is broken');
    });
    expect(() => captureError(new Error('boom'), { source: 'render' })).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('a second sink replaces the first', () => {
    const second = jest.fn<void, [CrashReport]>();
    setCrashSink(second);
    captureError(new Error('boom'));
    expect(sink).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('the module', () => {
  it('exports the seam and nothing else', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(Object.keys(require('../crashReporting') as object).sort()).toEqual(['captureError', 'setCrashSink']);
  });

  it('depends on no reporter: it imports the contract and the scrubbing rules only', () => {
    const source = readFileSync(resolve(__dirname, '../crashReporting.ts'), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);
    expect(imports.sort()).toEqual(['./crashScrub', '@bevi/shared']);
  });
});
