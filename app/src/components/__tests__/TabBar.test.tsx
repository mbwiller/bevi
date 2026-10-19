import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { size } from '@/theme';

import { TabBar, type TabBarProps } from '../TabBar';

const METRICS = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 34 } };
const renderBar = (props: TabBarProps) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TabBar {...props} />
    </SafeAreaProvider>,
  );

const LABELS = ['Feed', 'Your Lists', 'Search', 'Leaderboard', 'Profile'];

it('renders the five labelled tabs with 44pt targets and reports presses', async () => {
  const onChange = jest.fn();
  await renderBar({ onChange, user: { name: 'Matt Willer' } });
  for (const name of LABELS) {
    const tab = screen.getByRole('button', { name });
    expect(StyleSheet.flatten(tab.props.style).minHeight).toBe(size.target);
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Leaderboard' }));
  expect(onChange).toHaveBeenCalledWith('leaderboard');
  expect(screen.getByText('MW')).toBeTruthy();
});

it('marks only the active tab as the current page', async () => {
  await renderBar({ active: 'lists', user: { name: 'Matt Willer' } });
  expect(screen.getByRole('button', { name: 'Your Lists' }).props['aria-current']).toBe('page');
  expect(screen.getByRole('button', { name: 'Feed' }).props['aria-current']).toBeUndefined();
});

it('pads by the bottom inset only with safeArea', async () => {
  const pad = () => StyleSheet.flatten(screen.getByLabelText('Main').props.style).paddingBottom;
  await renderBar({});
  expect(pad()).toBe(34);
  await renderBar({ safeArea: false });
  expect(pad()).toBe(0);
});
