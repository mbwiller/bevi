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
      sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901', source: 'openfoodfacts',
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

  // The label-read half of the same round trip: `create_bev_with_nutrition_v2`
  // accepts a snapshot with no barcode, and `bevs.get` reads it back with its
  // `source` intact rather than defaulting it the way an older row is.
  //
  // `nutrition.scanLabel` itself is not exercised here: it needs the
  // `nutrition-ocr` function deployed with its model credential, and what it
  // reads out of a photo is not a fixture. Its mapping has unit tests.
  it('creates a Bev from a label read and reads the snapshot back', async () => {
    const authStorage = storage();
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage });
    const username = randomTestUsername();
    await api.signUp({ username, password: 'correct-horse-battery-staple', inviteCode: TEST_INVITE_CODE });
    const nutrition: NutritionPreview = {
      barcode: null, productName: 'Mountain Dew', basis: 'Per serving (12 fl oz (355 mL))',
      calories: 170, fatGrams: 0, carbohydrateGrams: 46, sugarGrams: 46,
      proteinGrams: null, sodiumMg: 60, sourceUrl: null, source: 'label-ocr',
    };
    try {
      const png = () => new Blob([PNG], { type: 'image/png' });
      const photo = await api.media.upload({ kind: 'bev-photo', file: png(), mimeType: 'image/png' });
      const label = await api.media.upload({ kind: 'label', file: png(), mimeType: 'image/png' });
      const input = {
        name: `Label ${username}`, categoryId: 'soda' as const, priceTier: 2 as const,
        priceEstimated: false, photoAssetId: photo.assetId, labelAssetId: label.assetId, nutrition,
      };
      const made = await api.bevs.create(input);
      expect(made.nutrition).toEqual(nutrition);
      expect((await api.bevs.get(made.id)).nutrition).toEqual(nutrition);
      // A label read with no label photo has nothing to have been read from.
      // Only the code is asserted: which field the RPC names is the SQL's.
      await expect(api.bevs.create({ ...input, name: `Unlabelled ${username}`, labelAssetId: undefined }))
        .rejects.toMatchObject({ code: 'validation' });
    } finally { await api.deleteAccount(); }
  });
});
