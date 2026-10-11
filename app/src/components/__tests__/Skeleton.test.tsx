import { render, screen } from '@testing-library/react-native';

import { Skeleton } from '../Skeleton';

it('announces row and post skeletons as loading, with a shimmer per bone', async () => {
  await render(
    <>
      <Skeleton variant="row" />
      <Skeleton variant="post" />
    </>,
  );
  const loading = screen.getAllByLabelText('Loading');
  expect(loading).toHaveLength(2);
  expect(loading[0]!.props['aria-busy']).toBe(true);
  // row: 4 lines + bubble; post: avatar, 2 lines, photo, note.
  expect(screen.getAllByTestId('shimmer', { includeHiddenElements: true })).toHaveLength(10);
});

it('draws plain shapes at the given size', async () => {
  await render(
    <>
      <Skeleton variant="text" lines={3} />
      <Skeleton variant="circle" width={44} />
      <Skeleton variant="block" height={80} />
    </>,
  );
  expect(screen.getAllByTestId('shimmer', { includeHiddenElements: true })).toHaveLength(5);
});
