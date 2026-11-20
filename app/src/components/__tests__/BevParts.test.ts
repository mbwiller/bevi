import type { BevSummary } from '@bevi/shared';

import { bevArtForCategory } from '../BevArt';
import { bevImageProps } from '../BevParts';

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
  iconLabelBand: null,
  photoStatus: 'ready',
  priceTier: 1,
  priceEstimated: true,
  ratingCount: 12,
  bayesScore: null,
};

const BAND = { x: 0.33, y: 0.29, width: 0.34, height: 0.25, dark: true };

// The reverse of what this asserted before contract 3.0.0. An icon is what a Bev looks like on
// Bevi, and the only Bev that has both is one somebody created from a photograph -- where the
// icon generated from that photograph is the point of the feature.
it('uses the icon over a real photo', () => {
  const props = bevImageProps({ ...BASE, photoUrl: 'https://example.com/pepsi.png', iconUrl: SERVED_ICON });
  expect(props.src).toBe(SERVED_ICON);
  expect(props.art).toBeUndefined();
});

it('uses the photo while the Bev has no icon, which is also what a failed generation leaves', () => {
  const props = bevImageProps({ ...BASE, photoUrl: 'https://example.com/pepsi.png' });
  expect(props.src).toBe('https://example.com/pepsi.png');
});

it('hands over the band and the wordmark to letter a generated icon', () => {
  const props = bevImageProps({ ...BASE, iconUrl: SERVED_ICON, iconLabelBand: BAND, brand: 'Acme' });
  expect(props.labelBand).toEqual(BAND);
  expect(props.wordmark).toBe('Acme');
});

it('letters an unbranded drink with its own name', () => {
  expect(bevImageProps({ ...BASE, brand: null, name: 'Chai from Small World' }).wordmark).toBe('Chai from Small World');
  expect(bevImageProps({ ...BASE, brand: '  ' }).wordmark).toBe('Pepsi');
});

it('offers no band for art that has its lettering drawn in already', () => {
  expect(bevImageProps({ ...BASE, iconUrl: SERVED_ICON }).labelBand).toBeNull();
  // A band cannot apply to a photo: there is no icon being drawn.
  expect(bevImageProps({ ...BASE, photoUrl: 'https://example.com/p.png', iconLabelBand: BAND }).labelBand).toBeNull();
});

it('uses the served icon (iconUrl) when there is no photo', () => {
  const props = bevImageProps({ ...BASE, iconUrl: SERVED_ICON });
  expect(props.src).toBe(SERVED_ICON);
  expect(props.art).toBeUndefined();
});

it('falls back to the category art when iconUrl is null', () => {
  const props = bevImageProps({ ...BASE, categoryId: 'juice' });
  expect(props.src).toBeUndefined();
  expect(props.art).toEqual(bevArtForCategory('juice'));
});

it('falls back to the category art when iconUrl is missing (a BevSummary from before contract 2.13.0)', () => {
  const old: Partial<BevSummary> = { ...BASE, categoryId: 'juice' };
  delete old.iconUrl;
  const props = bevImageProps(old as BevSummary);
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

// photoStatus describes the PHOTO: the shimmer belongs to background removal. An icon that
// exists is finished work, so it must not be drawn under a processing veil.
it('drops the photo status once the icon is what is drawn', () => {
  expect(
    bevImageProps({ ...BASE, iconUrl: SERVED_ICON, photoUrl: 'https://example.com/p.png', photoStatus: 'processing' }),
  ).toMatchObject({ src: SERVED_ICON, status: 'ready' });
});
