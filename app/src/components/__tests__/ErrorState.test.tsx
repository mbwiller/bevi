import { ApiError } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorState } from '../ErrorState';

it('defaults to the design-system copy with Retry', async () => {
  const onRetry = jest.fn();
  await render(<ErrorState onRetry={onRetry} />);
  expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityRole":"alert"');
  expect(screen.getByText("Couldn't load this")).toBeTruthy();
  expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('takes its copy from an ApiError, and drops Retry where it cannot help', async () => {
  const { rerender } = await render(<ErrorState error={new ApiError('network', 'x')} onRetry={() => {}} />);
  expect(screen.getByText("You're offline")).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  await rerender(<ErrorState error={new ApiError('not_found', 'x')} onRetry={() => {}} />);
  expect(screen.getByText("This isn't here anymore")).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('lets title and message override the error copy', async () => {
  await render(<ErrorState error={new ApiError('network', 'x')} title="Couldn't save your ranking" message="Try again in a moment." />);
  expect(screen.getByText("Couldn't save your ranking")).toBeTruthy();
  expect(screen.getByText('Try again in a moment.')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
