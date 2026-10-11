import { render, screen } from '@testing-library/react-native';

import { PriceTier, priceTierText } from '../PriceTier';

it.each([
  [1, '$'],
  [2, '$$'],
  [3, '$$$'],
  [4, '$$$$'],
] as const)('tier %s reads %s', async (tier, text) => {
  await render(<PriceTier tier={tier} />);
  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByLabelText(text)).toBeTruthy();
});

it('prefixes ~ when estimated', async () => {
  await render(<PriceTier tier={2} estimated />);
  expect(screen.getByText('~$$')).toBeTruthy();
  expect(screen.getByLabelText('about $$, estimated')).toBeTruthy();
});

it('clamps out-of-range tiers', () => {
  expect(priceTierText(0)).toBe('$');
  expect(priceTierText(7, true)).toBe('~$$$$');
});
