import { fireEvent, render, screen } from '@testing-library/react-native';

import { PriceTierPicker } from '../PriceTierPicker';

it('labels the four tiers and checks the chosen one', async () => {
  const onChange = jest.fn();
  await render(<PriceTierPicker onChange={onChange} />);
  for (const name of ['$', '$$', '$$$', '$$$$']) expect(screen.getByRole('radio', { name })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: '$$$' }));
  expect(onChange).toHaveBeenCalledWith(3, false);
  expect(screen.getByRole('radio', { name: '$$$', checked: true })).toBeTruthy();
  expect(screen.getByRole('radio', { name: '$', checked: false })).toBeTruthy();
});

it('"Not sure, estimate it" sends (null, true) and unchecks the tiers', async () => {
  const onChange = jest.fn();
  await render(<PriceTierPicker value={2} onChange={onChange} />);
  expect(screen.getByRole('radio', { name: '$$', checked: true })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Not sure, estimate it' }));
  expect(onChange).toHaveBeenCalledWith(null, true);
});

it('shows the estimate pill as pressed when estimated', async () => {
  await render(<PriceTierPicker value={null} estimated />);
  expect(screen.getByRole('button', { name: 'Not sure, estimate it' }).props['aria-pressed']).toBe(true);
  expect(screen.getByRole('radio', { name: '$$', checked: false })).toBeTruthy();
});
