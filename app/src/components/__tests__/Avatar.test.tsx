import { render, screen } from '@testing-library/react-native';

import { Avatar } from '../Avatar';

it('shows two initials and the name as its label', async () => {
  await render(<Avatar name="Matt Willer" size={60} />);
  expect(screen.getByText('MW')).toBeTruthy();
  expect(screen.getByLabelText('Matt Willer')).toBeTruthy();
});

it('shows a photo instead of initials', async () => {
  await render(<Avatar name="Sam Okafor" src="https://example.com/s.png" />);
  expect(screen.queryByText('SO')).toBeNull();
  expect(screen.getByLabelText('Sam Okafor')).toBeTruthy();
});

it('draws the 24pt size for inline comments with 9pt initials', async () => {
  await render(<Avatar name="Sam Okafor" size={24} />);
  const circle = screen.getByLabelText('Sam Okafor');
  expect(circle.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 24, height: 24 })]));
  expect(screen.getByText('SO').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontSize: 9 })]));
});
