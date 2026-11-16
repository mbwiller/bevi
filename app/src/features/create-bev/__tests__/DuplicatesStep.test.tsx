import { fireEvent, render, screen } from '@testing-library/react-native';

import { DuplicatesStep } from '../DuplicatesStep';

it('keeps the explicit continuation available offline while the duplicate check is loading', async () => {
  const onCreate = jest.fn();
  await render(
    <DuplicatesStep
      duplicates={undefined}
      loading
      checkFailed={false}
      onRetryCheck={() => undefined}
      onPick={() => undefined}
      onCreate={onCreate}
      creating={false}
      processing={false}
      submitMessage="Your Bev was added, but we couldn’t save its nutrition label. Continue without nutrition?"
      continueLabel="Continue without nutrition"
      blocked
    />,
  );

  const continueButton = screen.getByRole('button', { name: 'Continue without nutrition' });
  expect(continueButton).toBeEnabled();
  await fireEvent.press(continueButton);
  expect(onCreate).toHaveBeenCalledTimes(1);
});
