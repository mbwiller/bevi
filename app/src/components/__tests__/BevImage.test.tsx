import { render, screen } from '@testing-library/react-native';

import { BevImage } from '../BevImage';

it('labels the tile with the Bev name', async () => {
  await render(<BevImage art={{ kind: 'can' }} alt="Sprite" size={56} />);
  expect(screen.getByLabelText('Sprite')).toBeTruthy();
  expect(screen.queryByTestId('shimmer')).toBeNull();
});

it('renders a photo when it has a src', async () => {
  await render(<BevImage src="https://example.com/a.png" alt="Topo Chico" size={96} />);
  const tile = screen.getByLabelText('Topo Chico');
  expect(tile.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 96, height: 96 })]));
});

it('shimmers while processing and loading', async () => {
  await render(<BevImage art={{ kind: 'boba' }} alt="Horchata" status="processing" />);
  expect(screen.getByLabelText('Horchata (photo processing)')).toBeTruthy();
  expect(screen.getByTestId('shimmer')).toBeTruthy();
  await render(<BevImage status="loading" alt="Sprite" />);
  expect(screen.getByLabelText('Sprite, loading')).toBeTruthy();
});
