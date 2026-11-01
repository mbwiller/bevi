// The seeded catalog, photo upload → create_bev, duplicate detection and
// birth-date privacy against a real local stack (skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY, like the other *.live tests).
import { createClient } from '@supabase/supabase-js';
import { isApiError } from '@bevi/shared';
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import { usernameToEmail, type AuthStorageAdapter } from '../src/client.ts';
import { AGAINST_SHARED_PROJECT, randomTestUsername, TEST_INVITE_CODE } from './testUsername.ts';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const INVITE = TEST_INVITE_CODE;
const PASSWORD = 'correct-horse-battery-staple';

function memoryStorage(): AuthStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

// The smallest valid PNG (1×1, transparent).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

async function newUser(birthDate: string) {
  const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
  const username = randomTestUsername();
  const session = await api.signUp({ username, password: PASSWORD, inviteCode: INVITE });
  try {
    await api.profile.setBirthDate(birthDate);
  } catch (e) {
    await api.deleteAccount();
    throw e;
  }
  return { api, username, session };
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe.skipIf(!url || !publishableKey)('catalog, photos and privacy, against a live local stack', () => {
  it('serves the seeded catalog: at least 30 non-alcoholic starters, search, Bev detail', async () => {
    const { api } = await newUser('2008-01-01'); // under 21
    try {
      const starters = await api.bevs.getStarterCandidates();
      expect(starters.length).toBeGreaterThanOrEqual(30);
      const categories = await api.categories.list();
      const alcoholic = new Set(categories.filter((c) => c.isAlcoholic).map((c) => c.id));
      expect(alcoholic.size).toBe(0); // hidden for an under-21 viewer
      const progress = await api.stats.getCategoryProgress();
      expect(progress.map((p) => p.categoryId)).toEqual(categories.map((c) => c.id)); // the same age filter
      expect(starters.every((b) => !['beer', 'wine', 'spirits_cocktails'].includes(b.categoryId))).toBe(true);

      const found = await api.bevs.search({ q: 'coke' });
      expect(found.items.length).toBeGreaterThan(0);
      const detail = await api.bevs.get(found.items[0]!.id);
      expect(detail.name).toBeTruthy();
      expect(detail.photoUrl).toBeNull(); // seeded Bevs have no photo yet: the app draws placeholder art
      // A-17: every seeded Bev carries its hand-labelled flavour profile, and every Bev a
      // search for "coke" can return to an under-21 viewer is a cola.
      expect(detail.flavorProfile).toMatchObject({ base: 'cola', carbonated: true, alcohol: false, source: 'catalog' });
    } finally {
      await api.deleteAccount();
    }
  });

  // S-13 (20261101000500). Reports cascade with the account, so this leaves
  // nothing behind even against a shared project.
  it('reports a duplicate naming the original; rejects naming itself or an unknown Bev', async () => {
    const { api } = await newUser('1990-01-01');
    try {
      const [a, b] = await api.bevs.getStarterCandidates();
      await expect(api.bevs.report(a!.id, 'duplicate', { duplicateOfId: b!.id })).resolves.toBeUndefined();
      await expect(api.bevs.report(a!.id, 'wrong_info')).resolves.toBeUndefined(); // no original: still fine

      const self = await errorOf(api.bevs.report(b!.id, 'duplicate', { duplicateOfId: b!.id }));
      expect(isApiError(self) && self.code).toBe('validation');
      expect(isApiError(self) && self.detail).toEqual({ field: 'duplicateOfId' });

      const unknown = await errorOf(api.bevs.report(b!.id, 'duplicate', { duplicateOfId: crypto.randomUUID() }));
      expect(isApiError(unknown) && unknown.code).toBe('validation');
      expect(isApiError(unknown) && unknown.detail).toEqual({ field: 'duplicateOfId' });

      const missing = await errorOf(api.bevs.report(crypto.randomUUID(), 'wrong_info'));
      expect(isApiError(missing) && missing.code).toBe('not_found');
    } finally {
      await api.deleteAccount();
    }
  });

  it.skipIf(AGAINST_SHARED_PROJECT)('creates a Bev from an uploaded photo, visible to others; rejects unknown assets and exact duplicates', async () => {
    const a = await newUser('1990-01-01');
    const b = await newUser('1991-01-01');
    try {
      const bogus = await errorOf(
        a.api.bevs.create({ name: 'Nope', categoryId: 'soda', priceTier: 2, priceEstimated: false, photoAssetId: 'not-mine/x.png' }),
      );
      expect(isApiError(bogus) && bogus.code).toBe('validation');
      expect(isApiError(bogus) && bogus.detail).toEqual({ field: 'photoAssetId', reason: 'unknown_asset' });

      const upload = await a.api.media.upload({ kind: 'bev-photo', file: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' });
      expect(upload.assetId.startsWith(`${a.session.userId}/`)).toBe(true);

      const name = `Live Test Fizz ${crypto.randomUUID().slice(0, 8)}`;
      const created = await a.api.bevs.create({ name, brand: 'Test Brand', categoryId: 'soda', priceTier: 2, priceEstimated: false, photoAssetId: upload.assetId });
      expect(created.photoUrl).toContain(upload.assetId);
      expect(created.createdBy?.handle).toBe(a.username);

      // Another user sees it straight away (it is active, not pending a photo job).
      const seen = await b.api.bevs.get(created.id);
      expect(seen.name).toBe(name);
      expect(seen.flavorProfile).toBeNull(); // user-created: unlabelled until D-11
      expect((await b.api.bevs.search({ q: name })).items.map((x) => x.id)).toContain(created.id);

      // An exact duplicate is a conflict that names the existing Bev.
      const second = await a.api.media.upload({ kind: 'bev-photo', file: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' });
      const dup = await errorOf(
        a.api.bevs.create({ name, brand: 'Test Brand', categoryId: 'soda', priceTier: 2, priceEstimated: false, photoAssetId: second.assetId }),
      );
      expect(isApiError(dup) && dup.code).toBe('conflict');
      expect(isApiError(dup) && dup.detail).toEqual({ existingBevId: created.id });
    } finally {
      await a.api.deleteAccount();
      await b.api.deleteAccount();
    }
  });

  it('updateMe still writes the own-row columns under the profile column privileges', async () => {
    const { api } = await newUser('1990-01-01');
    try {
      const me = await api.profile.updateMe({ displayName: 'Live Tester', timezone: 'America/Chicago', onboarded: true });
      expect(me).toMatchObject({ displayName: 'Live Tester', timezone: 'America/Chicago', onboarded: true, birthdate: '1990-01-01' });
    } finally {
      await api.deleteAccount();
    }
  });

  it('a profile photo: upload to avatars, set it with updateMe, read it back, remove it', async () => {
    const { api, session } = await newUser('1990-01-01');
    try {
      const up = await api.media.upload({ kind: 'avatar', file: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' });
      expect(up.url).toContain('/avatars/');

      const me = await api.profile.updateMe({ avatarAssetId: up.assetId });
      expect(me.avatarUrl).toBe(up.url);
      expect((await api.profile.getMe()).avatarUrl).toBe(up.url);

      // Only the caller's own upload to `avatars` counts (set_avatar).
      const missing = await errorOf(api.profile.updateMe({ avatarAssetId: `${session.userId}/missing.png` }));
      expect(isApiError(missing) && missing.code === 'validation').toBe(true);
      expect(isApiError(missing) ? missing.detail : null).toMatchObject({ field: 'avatarAssetId', reason: 'unknown_asset' });
      const photo = await api.media.upload({ kind: 'bev-photo', file: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' });
      const wrongBucket = await errorOf(api.profile.updateMe({ avatarAssetId: photo.assetId }));
      expect(isApiError(wrongBucket) && wrongBucket.code === 'validation').toBe(true);
      expect((await api.profile.getMe()).avatarUrl).toBe(up.url);

      expect((await api.profile.updateMe({ avatarAssetId: null })).avatarUrl).toBeNull();
    } finally {
      await api.deleteAccount();
    }
  });

  it("never exposes another user's birth date", async () => {
    const a = await newUser('1990-05-05');
    const b = await newUser('1991-06-06');
    try {
      // Through the API: someone else's profile has no birthdate; your own does.
      expect((await b.api.profile.getUser(a.session.userId)).birthdate).toBeNull();
      expect((await a.api.profile.getMe()).birthdate).toBe('1990-05-05');

      // Straight at the table with B's session: the column is not readable at all.
      const raw = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: signInError } = await raw.auth.signInWithPassword({ email: usernameToEmail(b.username), password: PASSWORD });
      expect(signInError).toBeNull();
      const { error } = await raw.from('profiles').select('birth_date').eq('id', a.session.userId);
      expect(error).not.toBeNull();
      const { data: view } = await raw.from('profiles_view').select('birth_date, can_see_alcohol').eq('id', a.session.userId).single();
      expect(view).toEqual({ birth_date: null, can_see_alcohol: false });
      await raw.auth.signOut();

      // Signed out, profiles aren't readable at all.
      const anon = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: anonRows } = await anon.from('profiles_view').select('id');
      expect(anonRows ?? []).toEqual([]);
    } finally {
      await a.api.deleteAccount();
      await b.api.deleteAccount();
    }
  });
});
