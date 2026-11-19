import type { BevdPin } from '@bevi/shared';

import { colors } from '@/theme';

import { PIN, PIN_SELECTED, SELECTED_Z, pinBounds, pinCss, pinLabel, pinSignature, pinText, pinZIndex } from '../bevdPin';

const pin = (over: Partial<BevdPin> & { lat?: number; lng?: number } = {}): BevdPin => ({
  venue: {
    id: 'v1',
    name: 'Duane Reade',
    kind: 'chain',
    lat: over.lat ?? 40.7616,
    lng: over.lng ?? -73.9497,
    address: '425 Main Street',
    neighborhood: 'Roosevelt Island',
    borough: 'Manhattan',
    hoursOsm: null,
    hoursKnown: false,
    website: null,
  },
  bevCount: over.bevCount ?? 3,
  mineCount: over.mineCount ?? 1,
  latestAt: '2026-11-19T12:00:00Z',
});

it('pinText is the count, capped at 99+', () => {
  expect(pinText(pin({ bevCount: 1 }))).toBe('1');
  expect(pinText(pin({ bevCount: 99 }))).toBe('99');
  expect(pinText(pin({ bevCount: 100 }))).toBe('99+');
});

it('pinLabel says whose they are, so the fill is never the only signal', () => {
  expect(pinLabel(pin({ bevCount: 3, mineCount: 1 }))).toBe('Duane Reade, 3 Bevs, 1 yours');
  expect(pinLabel(pin({ bevCount: 2, mineCount: 2 }))).toBe('Duane Reade, 2 Bevs, yours');
  expect(pinLabel(pin({ bevCount: 1, mineCount: 0 }))).toBe('Duane Reade, 1 Bev, from people you follow');
});

it('pinCss fills a place of yours with primary and rings a friends-only one', () => {
  const look = { colors: colors.light, selected: false, reduced: false };
  const mine = pinCss(pin({ mineCount: 1 }), look);
  expect(mine).toContain(`background:${colors.light.primary}`);
  expect(mine).toContain(`color:${colors.light.onPrimary}`);
  expect(mine).toContain(`width:${PIN}px`);

  const theirs = pinCss(pin({ mineCount: 0 }), look);
  expect(theirs).toContain(`background:${colors.light.surface}`);
  expect(theirs).toContain(`border:2px solid ${colors.light.primary}`);
});

it('the selected pin is larger and on top; Reduce Motion drops the transition', () => {
  const selected = pinCss(pin(), { colors: colors.dark, selected: true, reduced: true });
  expect(selected).toContain(`width:${PIN_SELECTED}px`);
  expect(selected).not.toContain('transition');
  expect(pinZIndex(pin({ bevCount: 3 }), true)).toBe(SELECTED_Z);
  expect(pinZIndex(pin({ bevCount: 3 }), false)).toBe(3);
  expect(pinZIndex(pin({ bevCount: 999_999 }), false)).toBeLessThan(SELECTED_Z);
});

it('pinSignature changes with anything the marker shows, and with nothing else', () => {
  const look = { selected: false, reduced: false, scheme: 'light' };
  const base = pinSignature(pin(), look);
  expect(pinSignature(pin(), look)).toBe(base);
  expect(pinSignature(pin({ bevCount: 4 }), look)).not.toBe(base);
  expect(pinSignature(pin({ mineCount: 0 }), look)).not.toBe(base);
  expect(pinSignature(pin(), { ...look, selected: true })).not.toBe(base);
  expect(pinSignature(pin(), { ...look, scheme: 'dark' })).not.toBe(base);
});

it('pinBounds is the box around the pins, or null with none', () => {
  expect(pinBounds([])).toBeNull();
  expect(pinBounds([pin({ lat: 40.76, lng: -73.95 }), pin({ lat: 53.34, lng: -6.26 })])).toEqual({
    south: 40.76,
    north: 53.34,
    west: -73.95,
    east: -6.26,
  });
});
