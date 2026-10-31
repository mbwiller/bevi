import { PLACEMENT_TIER } from '@bevi/ranking';
import { ApiError } from '@bevi/shared';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';

import { loadPlacementList } from '../placementList';

// The tester's Loved list in the fixtures, best first (coffee leaves mixed with three sodas).
const LOVED = [
  'stok-cold-brew-black', // coffee / cold_brew
  'stok-cold-brew-not-too-sweet', // coffee / cold_brew
  'high-brew-salted-caramel', // coffee / flavored_latte
  'faygo-rock-and-rye', // soda / cream_soda
  'death-wish-coffee-rtd-black', // coffee / cold_brew
  'high-brew-mexican-vanilla', // coffee / flavored_latte
  'rise-brewing-nitro-cold-brew-oat-latte', // coffee / latte
  'aw-root-beer', // soda / root_beer
  'mexican-coca-cola', // soda / cola
];
const { sameLeaf: L, sameRoot: R, edge: E } = PLACEMENT_TIER;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(() => jest.restoreAllMocks());

it('the fixtures are the mixed bucket these tests assume', async () => {
  expect(await api.rankings.listBucket('LOVED')).toEqual(LOVED);
});

it('a new Bev gets a tier per bucket Bev: its leaf first, then its root', async () => {
  const res = await loadPlacementList(api, 'LOVED', { id: 'chameleon-cold-brew-black', categoryId: 'coffee' });
  expect(res.orderedIds).toEqual(LOVED);
  expect(res.tiers).toEqual([L, L, R, null, L, R, R, null, null]);
});

it('a stored edge reaches across roots (tier 3) when similarities answer', async () => {
  const res = await loadPlacementList(api, 'LOVED', { id: 'aw-diet-root-beer', categoryId: 'diet_soda' });
  expect(res.tiers).toEqual([null, null, null, null, null, null, null, E, null]);
});

it('a re-rank keeps the Bev in the list, with a tier array parallel to it', async () => {
  const res = await loadPlacementList(api, 'LOVED', { id: 'death-wish-coffee-rtd-black', categoryId: 'coffee' });
  expect(res.orderedIds).toEqual(LOVED);
  expect(res.tiers).toHaveLength(LOVED.length);
});

it('asks for leaves once, for the new Bev and the bucket together', async () => {
  const leaves = jest.spyOn(api.bevs, 'leaves');
  await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' });
  expect(leaves).toHaveBeenCalledTimes(1);
  expect(leaves.mock.calls[0]![0]).toEqual(['barqs-root-beer', ...LOVED]);
});

it('an empty bucket needs no leaves and has no tiers', async () => {
  controls.emptyUser();
  const leaves = jest.spyOn(api.bevs, 'leaves');
  expect(await loadPlacementList(api, 'FINE', { id: 'barqs-root-beer', categoryId: 'soda' })).toEqual({ orderedIds: [] });
  expect(leaves).not.toHaveBeenCalled();
});

it('listBucketBevs fails: the plain listBucket path, no tiers', async () => {
  jest.spyOn(api.rankings, 'listBucketBevs').mockRejectedValue(new ApiError('unknown', 'boom'));
  const leaves = jest.spyOn(api.bevs, 'leaves');
  expect(await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' })).toEqual({ orderedIds: LOVED });
  expect(leaves).not.toHaveBeenCalled();
});

it('both list reads fail: the error reaches the caller, as before', async () => {
  jest.spyOn(api.rankings, 'listBucketBevs').mockRejectedValue(new ApiError('network', 'offline'));
  jest.spyOn(api.rankings, 'listBucket').mockRejectedValue(new ApiError('network', 'offline'));
  await expect(loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' })).rejects.toMatchObject({ code: 'network' });
});

it('leaves fail: no tiers at all', async () => {
  jest.spyOn(api.bevs, 'leaves').mockRejectedValue(new ApiError('network', 'offline'));
  expect(await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' })).toEqual({ orderedIds: LOVED });
});

it('similarities fail: taxonomy tiers only', async () => {
  jest.spyOn(api.bevs, 'similarities').mockRejectedValue(new ApiError('network', 'offline'));
  const res = await loadPlacementList(api, 'LOVED', { id: 'aw-diet-root-beer', categoryId: 'diet_soda' });
  expect(res.tiers).toEqual(LOVED.map(() => null));
  const soda = await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' });
  expect(soda.tiers).toEqual([null, null, null, R, null, null, null, L, R]);
});

it('similarities that hang are given up on after the timeout: taxonomy tiers only', async () => {
  jest.spyOn(api.bevs, 'similarities').mockReturnValue(new Promise(() => {}));
  const t0 = Date.now();
  const res = await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' }, { similaritiesTimeoutMs: 50 });
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(res.tiers).toEqual([null, null, null, R, null, null, null, L, R]);
});

it('a Bev the leaves omit (not active) counts as having no leaf', async () => {
  const real = api.bevs.leaves.bind(api.bevs);
  jest.spyOn(api.bevs, 'leaves').mockImplementation(async (ids) => (await real(ids)).filter((l) => l.bevId !== 'aw-root-beer'));
  const res = await loadPlacementList(api, 'LOVED', { id: 'barqs-root-beer', categoryId: 'soda' });
  // aw-root-beer drops from the same leaf to the same root.
  expect(res.tiers).toEqual([null, null, null, R, null, null, null, R, R]);
});
