import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeaturedCard } from '../FeaturedCard';

it('shows title and subtitle over art, and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<FeaturedCard title="Brown Sugar Boba" subtitle="Boba • $$" art={{ kind: 'boba' }} onPress={onPress} />);
  expect(screen.getByText('Brown Sugar Boba')).toBeTruthy();
  expect(screen.getByText('Boba • $$')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Brown Sugar Boba, Boba • $$' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('renders a photo card without a subtitle', async () => {
  await render(<FeaturedCard title="Topo Chico" src="https://example.com/t.png" />);
  expect(screen.getByRole('button', { name: 'Topo Chico' })).toBeTruthy();
});
