import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BevGlow } from '../BevGlow';

it('renders its children over decorative, hidden blobs', async () => {
  await render(
    <BevGlow color="#f4a7b9">
      <Text>How was it?</Text>
    </BevGlow>,
  );
  expect(screen.getByText('How was it?')).toBeTruthy();
  const blobs = screen.getByTestId('bev-glow-blobs', { includeHiddenElements: true });
  expect(blobs.props['aria-hidden']).toBe(true);
  expect(blobs.props.pointerEvents).toBe('none');
  expect(screen.queryByTestId('bev-glow-blobs')).toBeNull();
});
