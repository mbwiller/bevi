import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size, spacing, type } from '@/theme';

import { BEV_ROW_FOOT_LINE } from '../BevRow';
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

it("is exactly as tall as a real BevRow's content, so nothing jumps when the row arrives", async () => {
  await render(<Skeleton variant="row" />);
  const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
  const row = StyleSheet.flatten(screen.getByLabelText('Loading').props.style);
  expect(row.minHeight).toBe(size.rowMin);
  expect(row.paddingTop).toBe(spacing.md);
  expect(row.paddingBottom).toBe(spacing.xs);
  expect(row.borderBottomWidth).toBe(1);

  // The text block's real height: its slots plus any gap between them (it must have none).
  const text = flat('skeleton-row-text');
  expect(text.gap ?? 0).toBe(0);
  const textHeight = flat('skeleton-row-title').height + flat('skeleton-row-line').height;
  expect(textHeight).toBe(type.screenTitle.lineHeight + type.body.lineHeight);
  const foot = flat('skeleton-row-foot').height;
  expect(foot).toBe(BEV_ROW_FOOT_LINE);

  const skeletonTotal = row.paddingTop + textHeight + foot + row.paddingBottom + row.borderBottomWidth;
  const realTotal =
    spacing.md + type.screenTitle.lineHeight + type.body.lineHeight + BEV_ROW_FOOT_LINE + spacing.xs + 1;
  expect(skeletonTotal).toBe(realTotal);
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
