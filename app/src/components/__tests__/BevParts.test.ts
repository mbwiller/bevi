import type { BevSummary } from '@bevi/shared';

import { BEV_ICONS } from '@/lib/bevIcons.generated';

import { bevArtForCategory } from '../BevArt';
import { bevImageProps } from '../BevParts';

// The FakeApi keys its catalog by slug, so these use a real catalog UUID: Pepsi's, which has an
// authored icon (design/beverage-icons/manifest.json).
const PEPSI_ID = '946588a1-e485-500a-a7c9-afdd321219b2';
const SERVED_ICON = 'https://example.supabase.co/storage/v1/object/public/bev-icons/pepsi.0123456789abcdef.svg';

const BASE: BevSummary = {
  id: PEPSI_ID,
  name: 'Pepsi',
  brand: 'Pepsi',
  flavor: 'Original',
  categoryId: 'soda',
  photoUrl: null,
  iconUrl: null,
  photoStatus: 'ready',
  priceTier: 1,
  priceEstimated: true,
  ratingCount: 12,
  bayesScore: null,
};

it('uses a real photo over an authored icon', () => {
  const props = bevImageProps({ ...BASE, photoUrl: 'https://example.com/pepsi.png', iconUrl: SERVED_ICON });
  expect(props.src).toBe('https://example.com/pepsi.png');
  expect(props.art).toBeUndefined();
});

it('uses the served icon (iconUrl) when there is no photo, over the bundled one', () => {
  const props = bevImageProps({ ...BASE, iconUrl: SERVED_ICON });
  expect(props.src).toBe(SERVED_ICON);
  expect(props.art).toBeUndefined();
});

it('uses the served icon for a Bev the bundled lookup does not know', () => {
  const props = bevImageProps({ ...BASE, id: '00000000-0000-5000-8000-000000000000', iconUrl: SERVED_ICON });
  expect(props.src).toBe(SERVED_ICON);
  expect(props.art).toBeUndefined();
});

it('falls back to the bundled icon when iconUrl is null', () => {
  const props = bevImageProps(BASE);
  expect(props.src).toBe(BEV_ICONS[PEPSI_ID]);
  expect(props.src).toMatch(/^\/bev-icons\/pepsi\.svg\?v=[0-9a-f]{8}$/);
  expect(props.art).toBeUndefined();
});

it('falls back to the bundled icon when iconUrl is missing (a BevSummary from before contract 2.13.0)', () => {
  const old: Partial<BevSummary> = { ...BASE };
  delete old.iconUrl;
  const props = bevImageProps(old as BevSummary);
  expect(props.src).toBe(BEV_ICONS[PEPSI_ID]);
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
