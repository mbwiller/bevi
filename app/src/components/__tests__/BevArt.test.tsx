import { render, screen } from '@testing-library/react-native';

import { BevArt, bevArtForCategory, bevArtKinds } from '../BevArt';
import { CATEGORIES } from '@/lib/categories';

it('has every design system kind', () => {
  expect(bevArtKinds).toEqual(['can', 'slimCan', 'bottle', 'waterBottle', 'boba', 'icedCup', 'mug', 'wine', 'pint', 'carton']);
});

it.each(bevArtKinds)('renders %s', async (kind) => {
  await render(<BevArt kind={kind} color="#123456" accent="#654321" title={kind} />);
  expect(screen.getByLabelText(kind)).toBeTruthy();
});

it('gives every category default art', () => {
  for (const c of CATEGORIES) {
    const art = bevArtForCategory(c.id);
    expect(bevArtKinds).toContain(art.kind);
    expect(art.color).toMatch(/^#/);
  }
  expect(bevArtForCategory('boba').kind).toBe('boba');
  expect(bevArtForCategory('beer').kind).toBe('pint');
});
