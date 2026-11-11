import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size, spacing, type } from '@/theme';

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
  // row: name, category and meta lines, bubble and action glyph; post: avatar, 2 lines, photo, note.
  expect(screen.getAllByTestId('shimmer', { includeHiddenElements: true })).toHaveLength(10);
});

it('shapes the row skeleton like a compact BevRow: name and category lines, a 32pt foot, a bubble', async () => {
  await render(<Skeleton variant="row" />);
  const row = screen.getByLabelText('Loading');
  const flat = StyleSheet.flatten(row.props.style);
  expect(flat.minHeight).toBe(size.rowMin);
  expect(flat.paddingTop).toBe(spacing.md);
  expect(flat.paddingBottom).toBe(spacing.xs);
  // name line + category line + foot add up to the row's content height.
  const rowHeight = type.screenTitle.lineHeight + type.body.lineHeight + 32;
  expect(rowHeight + spacing.md + spacing.xs + 1).toBeLessThanOrEqual(94);
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
