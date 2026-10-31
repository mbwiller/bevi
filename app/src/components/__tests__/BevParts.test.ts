import type { BevSummary } from '@bevi/shared';

import { BEV_ICONS } from '@/lib/bevIcons.generated';

import { bevArtForCategory } from '../BevArt';
import { bevImageProps } from '../BevParts';

// The FakeApi keys its catalog by slug, so these use a real catalog UUID: Pepsi's, which has an
// authored icon (design/beverage-icons/manifest.json).
const PEPSI_ID = '946588a1-e485-500a-a7c9-afdd321219b2';

const BASE: BevSummary = {
  id: PEPSI_ID,
  name: 'Pepsi',
  brand: 'Pepsi',
  flavor: 'Original',
  categoryId: 'soda',
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 1,
  priceEstimated: true,
  ratingCount: 12,
  bayesScore: null,
};

it('uses a real photo over an authored icon', () => {
  const props = bevImageProps({ ...BASE, photoUrl: 'https://example.com/pepsi.png' });
  expect(props.src).toBe('https://example.com/pepsi.png');
  expect(props.art).toBeUndefined();
});

it('uses the authored icon when there is no photo', () => {
  const props = bevImageProps(BASE);
  expect(props.src).toBe(BEV_ICONS[PEPSI_ID]);
  expect(props.src).toMatch(/^\/bev-icons\/pepsi\.svg\?v=[0-9a-f]{8}$/);
  expect(props.art).toBeUndefined();
});

it('falls back to the category art when there is neither', () => {
  const props = bevImageProps({ ...BASE, id: '00000000-0000-5000-8000-000000000000', categoryId: 'juice' });
  expect(props.src).toBeUndefined();
  expect(props.art).toEqual(bevArtForCategory('juice'));
});

it('passes the name and photo status through', () => {
  expect(bevImageProps(BASE)).toMatchObject({ alt: 'Pepsi', status: 'ready' });
  expect(bevImageProps({ ...BASE, photoUrl: 'https://example.com/p.png', photoStatus: 'processing' })).toMatchObject({
    alt: 'Pepsi',
    status: 'processing',
  });
});
