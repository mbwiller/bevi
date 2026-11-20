import { PLACE_TYPES } from '@bevi/shared';

import { PLACE_ICON, PLACE_TYPE_LABEL, placeIcon } from '../placeIcon';

it('a cafe is a cup, a shop a can, a bar a glass, and a liquor shop a wine glass', () => {
  expect(placeIcon('cafe')).toBe('coffee');
  expect(placeIcon('store')).toBe('cup-soda');
  expect(placeIcon('bar')).toBe('martini');
  expect(placeIcon('liquor')).toBe('wine');
});

it('every place type has a glyph and a spoken name, and only an untyped place is the plain pin', () => {
  for (const t of PLACE_TYPES) {
    expect(PLACE_ICON[t]).toBeTruthy();
    expect(PLACE_TYPE_LABEL[t]).toBeTruthy();
    if (t !== 'other') expect(placeIcon(t)).not.toBe('map-pin');
  }
  expect(placeIcon('other')).toBe('map-pin');
  expect(placeIcon(null)).toBe('map-pin');
  expect(placeIcon(undefined)).toBe('map-pin');
  // A type a newer backend adds reads as the plain pin, not as a crash.
  expect(placeIcon('spaceport' as never)).toBe('map-pin');
});
