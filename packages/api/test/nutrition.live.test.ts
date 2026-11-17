// Local-only: a created Bev outlives its creator. Never run this against a shared project.
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index';
import type { AuthStorageAdapter } from '../src/client';
import type { NutritionPreview } from '@bevi/shared';
import { AGAINST_SHARED_PROJECT, randomTestUsername, TEST_INVITE_CODE } from './testUsername';
const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
function storage(): AuthStorageAdapter {
  const items = new Map<string, string>();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => { items.set(k, v); }, removeItem: (k) => { items.delete(k); } };
}
describe.skipIf(!url || !publishableKey || AGAINST_SHARED_PROJECT)('nutrition persistence against a local stack', () => {
  it('creates nutrition atomically and reads it back after a fresh sign-in', async () => {
    const authStorage = storage();
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage });
    const username = randomTestUsername();
    const password = 'correct-horse-battery-staple';
    await api.signUp({ username, password, inviteCode: TEST_INVITE_CODE });
    const nutrition: NutritionPreview = {
      barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
      calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
      sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901',
    };
    try {
      const photo = await api.media.upload({ kind: 'bev-photo', file: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' });
      const input = { name: `Nutrition ${username}`, categoryId: 'water' as const, priceTier: 2 as const, priceEstimated: false, photoAssetId: photo.assetId, nutrition };
      const made = await api.bevs.create(input);
      expect(made.nutrition).toEqual(nutrition);
      await api.signOut();
      await api.signIn({ username, password });
      expect((await api.bevs.get(made.id)).nutrition).toEqual(nutrition);
      await expect(api.bevs.create({ ...input, name: `Invalid ${username}`, nutrition: { ...nutrition, calories: -1 } })).rejects.toMatchObject({ code: 'validation', detail: { field: 'nutrition' } });
      expect((await api.bevs.search({ q: `Invalid ${username}` })).items.map((b) => b.name)).not.toContain(`Invalid ${username}`);
    } finally { await api.deleteAccount(); }
  });
});
