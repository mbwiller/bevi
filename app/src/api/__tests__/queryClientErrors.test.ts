import type { ApiErrorCode } from '@bevi/shared';

// A read or a save that React Query gives up on is handed to crash reporting (queryClient.ts), and
// crash reporting drops the ones the app expects. Run through the real lib/crashReporting.ts with
// reporting on and the SDK mocked (jest.setup.js), so this is the rule as a build applies it: what
// reaches `captureException` is what would be sent. Each case loads a fresh copy of the modules
// under a DSN, as crashReporting.test.ts does.

type QueryClientModule = typeof import('../queryClient');
type Shared = typeof import('@bevi/shared');
type Crash = typeof import('@/lib/crashReporting');

const env = process.env as Record<string, string | undefined>;
const globals = globalThis as unknown as { __DEV__: boolean };
const savedDev = globals.__DEV__;

function load({ dsn = 'https://publickey@o0.ingest.sentry.invalid/1' }: { dsn?: string | null } = {}) {
  jest.resetModules();
  if (dsn === null) delete env.EXPO_PUBLIC_SENTRY_DSN;
  else env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  globals.__DEV__ = false;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Sentry = require('@sentry/react-native') as { captureException: jest.Mock };
  (require('@/lib/crashReporting') as Crash).initCrashReporting();
  const { createQueryClient } = require('../queryClient') as QueryClientModule;
  const { ApiError } = require('@bevi/shared') as Shared;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const client = createQueryClient();
  // The failure is what is under test, not the two tries a read gets first. And nothing is kept
  // for later collection, which would leave a five-minute timer running after the suite.
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } });
  return { Sentry, client, ApiError };
}

afterEach(() => {
  delete env.EXPO_PUBLIC_SENTRY_DSN;
  globals.__DEV__ = savedDev;
});

const EXPECTED: ApiErrorCode[] = ['network', 'unauthorized', 'validation', 'not_found', 'rate_limited', 'conflict', 'age_restricted'];

describe('a read that fails', () => {
  it.each(EXPECTED)('is not reported when the app expects the error (%s)', async (code) => {
    const { Sentry, client, ApiError } = load();
    const error = new ApiError(code, 'expected');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'bevs', 'detail', 'bev-1'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    client.clear();
  });

  it('is reported when the error has no name in the contract, with the family of the read and nothing else of its key', async () => {
    const { Sentry, client, ApiError } = load();
    const error = new ApiError('unknown', 'search_users returned no rows array');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'users', 'search', 'what the person typed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { source: 'query', api_code: 'unknown' }, extra: { read: 'users' } });
    expect(JSON.stringify(Sentry.captureException.mock.calls[0][1])).not.toContain('what the person typed');
    client.clear();
  });

  it('is reported when it is a bug in the app', async () => {
    const { Sentry, client } = load();
    const error = new TypeError("Cannot read properties of undefined (reading 'map')");
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { source: 'query' }, extra: { read: 'feed' } });
    client.clear();
  });

  it('is reported once, after its retries, not once per try', async () => {
    const { Sentry, client } = load();
    const error = new Error('still broken');
    const queryFn = jest.fn(() => Promise.reject(error));
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn, retry: 2, retryDelay: 0 })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    client.clear();
  });
});

describe('a save that fails', () => {
  async function save(client: ReturnType<typeof load>['client'], error: unknown): Promise<void> {
    const mutation = client.getMutationCache().build(client, { mutationFn: () => Promise.reject(error) });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
  }

  it.each(EXPECTED)('is not reported when the app expects the error (%s)', async (code) => {
    const { Sentry, client, ApiError } = load();
    await save(client, new ApiError(code, 'expected'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    client.clear();
  });

  it('is reported when it is unexpected', async () => {
    const { Sentry, client, ApiError } = load();
    const error = new ApiError('unknown', 'submit_ranking returned no row', { note: 'what the person wrote' });
    await save(client, error);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { source: 'mutation', api_code: 'unknown' }, extra: undefined });
    client.clear();
  });
});

describe('a build with no DSN', () => {
  it('reports nothing, whatever fails', async () => {
    const { Sentry, client } = load({ dsn: null });
    const error = new Error('boom');
    await expect(client.fetchQuery({ queryKey: ['bevi', 'feed'], queryFn: () => Promise.reject(error) })).rejects.toBe(error);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    client.clear();
  });
});
