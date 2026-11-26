// DELIVERABLE-44: go-to categories round-tripped through createBeviApi against a
// live local stack (see auth.live.test.ts for why this is skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY). The rules themselves are pinned in
// supabase/tests/47_category_picks.test.sql; this checks what packages/api
// makes of them: the column names it reads, the argument it sends, and which
// ApiError each refusal becomes.
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';
import { randomTestUsername, TEST_INVITE_CODE } from './testUsername.ts';

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

function newApi() {
  return createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
}

const PASSWORD = 'correct-horse-battery-staple';

describe.skipIf(!url || !publishableKey)('category picks, against a live local stack', () => {
  it('set, read back, replace, clear; validation and the age gate', async () => {
    const api = newApi();
    await api.signUp({ username: randomTestUsername(), password: PASSWORD, inviteCode: TEST_INVITE_CODE });
    try {
      // No birthdate yet: the caller cannot see alcohol.
      expect(await api.profile.getCategoryPicks()).toEqual([]);

      expect(await api.profile.setCategoryPicks(['coffee', 'soda', 'tea'])).toEqual(['coffee', 'soda', 'tea']);
      expect(await api.profile.getCategoryPicks()).toEqual(['coffee', 'soda', 'tea']);

      expect(await api.profile.setCategoryPicks(['tea'])).toEqual(['tea']);
      expect(await api.profile.getCategoryPicks()).toEqual(['tea']);

      await expect(api.profile.setCategoryPicks(['soda', 'juice', 'tea', 'coffee'])).rejects.toMatchObject({
        code: 'validation',
        detail: { field: 'categoryIds' },
      });
      await expect(api.profile.setCategoryPicks(['soda', 'soda'])).rejects.toMatchObject({
        code: 'validation',
        detail: { field: 'categoryIds' },
      });
      // A leaf is not a CategoryId; a client built against an older catalog could still send one.
      await expect(api.profile.setCategoryPicks(['cola' as never])).rejects.toMatchObject({
        code: 'validation',
        detail: { field: 'categoryIds' },
      });
      await expect(api.profile.setCategoryPicks(['beer'])).rejects.toMatchObject({ code: 'age_restricted' });
      // Nothing was saved by any refusal.
      expect(await api.profile.getCategoryPicks()).toEqual(['tea']);

      await api.profile.setBirthDate('1990-01-01');
      expect(await api.profile.setCategoryPicks(['beer', 'water'])).toEqual(['beer', 'water']);

      expect(await api.profile.setCategoryPicks([])).toEqual([]);
      expect(await api.profile.getCategoryPicks()).toEqual([]);
    } finally {
      await api.deleteAccount();
    }
  });

  it("nobody else reads a user's picks", async () => {
    const owner = newApi();
    const reader = newApi();
    await owner.signUp({ username: randomTestUsername(), password: PASSWORD, inviteCode: TEST_INVITE_CODE });
    await reader.signUp({ username: randomTestUsername(), password: PASSWORD, inviteCode: TEST_INVITE_CODE });
    try {
      await owner.profile.setCategoryPicks(['juice', 'boba']);
      expect(await reader.profile.getCategoryPicks()).toEqual([]);
      expect(await owner.profile.getCategoryPicks()).toEqual(['juice', 'boba']);
    } finally {
      await owner.deleteAccount();
      await reader.deleteAccount();
    }
  });
});
