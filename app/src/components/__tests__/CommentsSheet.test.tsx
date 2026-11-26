import { render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { CommentsSheet } from '../CommentsSheet';

const { height } = Dimensions.get('window');
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
const ME = { id: 'me', displayName: 'Test User', avatarUrl: null };

it('opens a little above the middle: 60% of the screen, in a sheet that can take all of it', async () => {
  await render(<CommentsSheet open me={ME} onClose={jest.fn()} />);
  // Laid out at the whole screen and slid down to 60%: the body is padded by the 40% under the fold.
  expect(flat('sheet').height).toBe(height);
  expect(flat('sheet-body').paddingBottom).toBeCloseTo(height * 0.4);
});

it('keeps the composer in the sheet footer, on the bottom edge at either height', async () => {
  await render(<CommentsSheet open me={ME} onClose={jest.fn()} />);
  const footer = within(screen.getByTestId('sheet-footer'));
  expect(footer.getByTestId('comment-composer')).toBeTruthy();
  expect(footer.getByLabelText('Add a comment')).toBeTruthy();
  expect(footer.getByRole('button', { name: 'Post' })).toBeTruthy();
  // The empty thread is the body, not the footer.
  expect(within(screen.getByTestId('sheet-body')).getByText('No comments yet')).toBeTruthy();
});

it('lets the thread move the sheet on a phone: its body takes a drag', async () => {
  const { getByGestureTestId } = require('react-native-gesture-handler/jest-utils');
  await render(<CommentsSheet open me={ME} onClose={jest.fn()} />);
  expect(getByGestureTestId('sheet-body')).toBeTruthy();
});
