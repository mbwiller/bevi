import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { FormError } from '../AuthScreen';

const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});

beforeEach(() => announce.mockClear());

it('says the error aloud when it appears or changes, and nothing without one', async () => {
  const { rerender } = await render(<FormError />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(announce).not.toHaveBeenCalled();

  await rerender(<FormError>Wrong username or password.</FormError>);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(announce).toHaveBeenLastCalledWith('Wrong username or password.');

  await rerender(<FormError>Wrong username or password.</FormError>);
  expect(announce).toHaveBeenCalledTimes(1);

  await rerender(<FormError>You're offline.</FormError>);
  expect(announce).toHaveBeenLastCalledWith("You're offline.");
  await rerender(<FormError />);
  expect(announce).toHaveBeenCalledTimes(2);
});
