import { render, screen } from '@testing-library/react-native';

import { AvatarStack } from '../AvatarStack';

const people = ['Jack Torres', 'Priya Nair', 'Sam Okafor', 'Lena Park', 'Arjun Cheema', 'Diego Ruiz'].map((name) => ({ name }));

it('shows max avatars and a +N chip', async () => {
  await render(<AvatarStack people={people} />);
  expect(screen.getByText('+2')).toBeTruthy();
  expect(screen.getByText('LP')).toBeTruthy();
  expect(screen.queryByText('AC')).toBeNull();
  expect(screen.getByLabelText(people.map((p) => p.name).join(', '))).toBeTruthy();
});

it('has no chip when everyone fits', async () => {
  await render(<AvatarStack people={people.slice(0, 2)} max={3} />);
  expect(screen.queryByText(/^\+/)).toBeNull();
});
