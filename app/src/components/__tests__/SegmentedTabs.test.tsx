import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedTabs } from '../SegmentedTabs';

const TABS = [
  { id: 'bevd', label: "Bev'd" },
  { id: 'want', label: 'Want to Try' },
  { id: 'recs', label: 'Recommended' },
];

it('renders labelled tabs and selects the first by default', async () => {
  await render(<SegmentedTabs tabs={TABS} />);
  expect(screen.getByRole('tab', { name: "Bev'd", selected: true })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Recommended', selected: false })).toBeTruthy();
});

it('selects a tab on press and reports it', async () => {
  const onChange = jest.fn();
  await render(<SegmentedTabs tabs={TABS} onChange={onChange} />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Want to Try' }));
  expect(onChange).toHaveBeenCalledWith('want');
  expect(screen.getByRole('tab', { name: 'Want to Try', selected: true })).toBeTruthy();
  expect(screen.getByRole('tab', { name: "Bev'd", selected: false })).toBeTruthy();
});

it('follows a controlled value in the icon variant', async () => {
  await render(
    <SegmentedTabs
      variant="underline-icon"
      accent="primary"
      value="people"
      tabs={[
        { id: 'bevs', label: 'Bevs', icon: 'cup-soda' },
        { id: 'people', label: 'People', icon: 'users' },
      ]}
    />,
  );
  expect(screen.getByRole('tab', { name: 'People', selected: true })).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Bevs' }));
  // Controlled: stays on the parent's value until it changes.
  expect(screen.getByRole('tab', { name: 'People', selected: true })).toBeTruthy();
});
