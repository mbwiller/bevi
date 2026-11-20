import { ApiError, type ApiErrorCode } from '@bevi/shared';
import type { QueryClient } from '@tanstack/react-query';

import { setCrashSink, type CrashReport } from '@/lib/crashReporting';

import { createQueryClient } from '../queryClient';

// A read or a save that React Query gives up on is handed to `captureError` (queryClient.ts), which
// drops the ones the app expects. Run through the real lib/crashReporting.ts with a sink
// registered, so this is the rule as the app applies it: what reaches the sink is what a reporter
// would get.

const sink = jest.fn<void, [CrashReport]>();
let client: QueryClient;

beforeEach(() => {
  sink.mockReset();
  setCrashSink(sink);
  client = createQueryClient();
  // The failure is what is under test, not the two tries a read gets first. And nothing is kept
  // for later collection, which would leave a five-minute timer running after the suite.
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } });
});

afterEach(() => {
  client.clear();
  setCrashSink(null);
});

const EXPECTED: ApiErrorCode[] = ['network', 'unauthorized', 'validation', 'not_found', 'rate_limited', 'conflict', 'age_restricted'];

describe('a read that fails', () => {
  it.each(EXPECTED)('is not reported when the app expects the error (%s)', async (code) => {
    const error = new ApiError(code, 'expected');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'bevs', 'detail', 'bev-1'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(sink).not.toHaveBeenCalled();
  });

  it('is reported when the error has no name in the contract, with the family of the read and nothing else of its key', async () => {
    const error = new ApiError('unknown', 'search_users returned no rows array');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'users', 'search', 'what the person typed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({
      name: 'ApiError',
      message: 'search_users returned no rows array',
      source: 'query',
      apiCode: 'unknown',
      extra: { read: 'users' },
    });
    expect(JSON.stringify(sink.mock.calls[0]![0])).not.toContain('what the person typed');
  });

  it('is reported when it is a bug in the app', async () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'map')");
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ name: 'TypeError', source: 'query', extra: { read: 'feed' } });
    expect(sink.mock.calls[0]![0]).not.toHaveProperty('apiCode');
  });

  it('is reported once, after its retries, not once per try', async () => {
    const error = new Error('still broken');
    const queryFn = jest.fn(() => Promise.reject(error));
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn, retry: 2, retryDelay: 0 })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe('a save that fails', () => {
  async function save(error: unknown): Promise<void> {
    const mutation = client.getMutationCache().build(client, { mutationFn: () => Promise.reject(error) });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
  }

  it.each(EXPECTED)('is not reported when the app expects the error (%s)', async (code) => {
    await save(new ApiError(code, 'expected'));
    expect(sink).not.toHaveBeenCalled();
  });

  it('is reported when it is unexpected, without what the person sent', async () => {
    await save(new ApiError('unknown', 'submit_ranking returned no row', { note: 'what the person wrote' }));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ name: 'ApiError', source: 'mutation', apiCode: 'unknown' });
    expect(sink.mock.calls[0]![0]).not.toHaveProperty('extra');
    expect(JSON.stringify(sink.mock.calls[0]![0])).not.toContain('what the person wrote');
  });
});

describe('with no sink registered', () => {
  it('nothing is reported and nothing breaks, whatever fails', async () => {
    setCrashSink(null);
    const error = new Error('boom');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(sink).not.toHaveBeenCalled();
  });
});
