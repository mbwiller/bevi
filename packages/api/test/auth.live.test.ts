// Runs against a real local Supabase stack (`supabase start`), not mocks --
// milestone 1.1's "vitest harness with seeded users". Skipped entirely when
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY aren't set, which is every run in
// this environment (no Docker/supabase CLI here -- see the PR description);
// CI's `db` job sets them from `supabase status` before this runs.
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

function memoryStorage(): AuthStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

describe.skipIf(!url || !publishableKey)('auth, against a live local stack', () => {
  it('signs up, is signed in, signs out, and the account can be deleted', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    // Matches seed.sql's local-only invite_code row -- see supabase/seed.sql.
    const username = `vitest_${Date.now().toString(36)}`;

    const signedUp = await api.signUp({ username, password: 'correct-horse-battery-staple', inviteCode: 'local-test-invite-code' });
    expect(signedUp.handle).toBe(username);

    const session = await api.getSession();
    expect(session?.userId).toBe(signedUp.userId);

    await api.signOut();
    expect(await api.getSession()).toBeNull();

    await api.signIn({ username, password: 'correct-horse-battery-staple' });
    await api.deleteAccount();
    expect(await api.getSession()).toBeNull();
  });

  it('rejects a bad invite code as validation, not a generic error', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const username = `vitest_${Date.now().toString(36)}_bad`;
    await expect(api.signUp({ username, password: 'correct-horse-battery-staple', inviteCode: 'wrong-code' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
