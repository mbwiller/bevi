import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors, size } from '@/theme';

import { TabBar, type TabBarProps, type TabId } from '../TabBar';

const METRICS = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 34 } };
const renderBar = (props: TabBarProps) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TabBar {...props} />
    </SafeAreaProvider>,
  );

const TABS: [TabId, string][] = [
  ['feed', 'Feed'],
  ['lists', 'Lists'],
  ['add', 'Add Bev'],
  ['map', 'Map'],
  ['profile', 'Profile'],
];
const light = colors.light;
const tab = (name: string) => screen.getByRole('button', { name });
const label = (name: string) => StyleSheet.flatten(within(tab(name)).getByText(name, { includeHiddenElements: true }).props.style);

it('renders Feed, Lists, Add Bev, Map and Profile, left to right, with 44pt targets, and reports presses', async () => {
  const onChange = jest.fn();
  await renderBar({ onChange, user: { name: 'Matt Willer' } });
  expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(TABS.map(([, l]) => l));
  for (const [id, name] of TABS) {
    expect(StyleSheet.flatten(tab(name).props.style).minHeight).toBe(size.target);
    await fireEvent.press(tab(name));
    expect(onChange).toHaveBeenLastCalledWith(id);
  }
  expect(screen.queryByRole('button', { name: 'Leaderboard' })).toBeNull();
  expect(screen.getByText('MW')).toBeTruthy();
});

it('marks only the active tab as the current page, in primary and bold', async () => {
  await renderBar({ active: 'map', user: { name: 'Matt Willer' } });
  expect(tab('Map').props['aria-current']).toBe('page');
  expect(tab('Map').props.accessibilityState).toEqual({ selected: true });
  expect(tab('Feed').props['aria-current']).toBeUndefined();
  expect(label('Map')).toMatchObject({ color: light.primary, fontWeight: '700' });
  expect(label('Feed').color).toBe(light.text);
  expect(label('Feed').fontWeight).not.toBe('700');
});

it('Add Bev is a raised 46pt primary circle with a 4pt surface ring', async () => {
  await renderBar({ active: 'feed' });
  const circle = StyleSheet.flatten(screen.getByTestId('tab-add-circle').props.style);
  expect(circle).toMatchObject({ width: 46, height: 46, backgroundColor: light.primary, boxShadow: `0 0 0 4px ${light.surface}` });
});

it('rings the active Profile avatar in primary, past a surface gap', async () => {
  const avatar = () => StyleSheet.flatten(screen.getByLabelText('Matt Willer').props.style);
  await renderBar({ active: 'feed', user: { name: 'Matt Willer' } });
  expect(avatar().boxShadow).toBeUndefined();
  await renderBar({ active: 'profile', user: { name: 'Matt Willer' } });
  expect(avatar().boxShadow).toBe(`0 0 0 2px ${light.surface}, 0 0 0 3.5px ${light.primary}`);
});

it('paints above the screens, so the raised circle is never covered', async () => {
  await renderBar({});
  expect(StyleSheet.flatten(screen.getByLabelText('Main').props.style).zIndex).toBeGreaterThan(0);
});

it('pads by the bottom inset only with safeArea', async () => {
  const pad = () => StyleSheet.flatten(screen.getByLabelText('Main').props.style).paddingBottom;
  await renderBar({});
  expect(pad()).toBe(34);
  await renderBar({ safeArea: false });
  expect(pad()).toBe(0);
});
