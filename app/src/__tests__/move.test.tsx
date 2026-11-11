import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';

import { useSession } from '@/state/session';

// Move, as the two layouts wire it: which screens enter, and how. ScreenMotion's own suite covers
// what each entrance draws; here every StackScene mount and each TabScene's latest props are recorded.
type StackMount = { variant: string; enter: boolean };
const mockStackMounts: StackMount[] = [];
const mockTabs: Record<string, { variant: string; active: boolean }> = {};
jest.mock('@/components/ScreenMotion', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('@/components/ScreenMotion')>('@/components/ScreenMotion');
  return {
    ...actual,
    StackScene: (props: Parameters<typeof actual.StackScene>[0]) => {
      React.useState(() => mockStackMounts.push({ variant: props.variant, enter: props.enter }));
      return React.createElement(actual.StackScene, props);
    },
    TabScene: (props: Parameters<typeof actual.TabScene>[0]) => {
      mockTabs[props.name] = { variant: props.variant, active: props.active };
      return React.createElement(actual.TabScene, props);
    },
  };
});

const APP_DIR = path.resolve(__dirname, '../app');

async function start(initialUrl: string) {
  useSession.setState({ status: 'ready', profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

beforeEach(() => {
  mockStackMounts.length = 0;
  for (const k of Object.keys(mockTabs)) delete mockTabs[k];
});

it('the screens the app starts on just show', async () => {
  await start('/feed');
  await screen.findByLabelText('Find people');
  expect(mockStackMounts.length).toBeGreaterThan(0);
  expect(mockStackMounts.every((m) => !m.enter)).toBe(true);
  expect(mockTabs['feed/index']).toEqual({ variant: 'fade', active: true });
});

it('/ redirects to the Feed without an entrance', async () => {
  const pathname = await start('/');
  await screen.findByLabelText('Find people');
  expect(pathname()).toBe('/feed');
  expect(mockStackMounts.every((m) => !m.enter)).toBe(true);
});

it('a deep link opens without an entrance', async () => {
  await start('/bev/abc');
  await screen.findByLabelText('Back');
  expect(mockStackMounts.every((m) => !m.enter)).toBe(true);
});

it('a pushed screen slides in, a full-screen modal rises, and going back mounts nothing', async () => {
  const pathname = await start('/feed');
  await screen.findByLabelText('Find people');
  const before = mockStackMounts.length;

  await act(async () => router.push('/bev/abc'));
  await waitFor(() => expect(pathname()).toBe('/bev/abc'));
  expect(mockStackMounts.slice(before)).toEqual([{ variant: 'push', enter: true }]);

  await act(async () => router.push('/image/x'));
  await waitFor(() => expect(pathname()).toBe('/image/x'));
  expect(mockStackMounts.slice(before)).toEqual([
    { variant: 'push', enter: true },
    { variant: 'rise', enter: true },
  ]);

  // The tab group stays the tab navigator's current scene under a push, so coming back replays nothing.
  expect(mockTabs['feed/index']!.active).toBe(true);
  await act(async () => router.back());
  await act(async () => router.back());
  await waitFor(() => expect(pathname()).toBe('/feed'));
  expect(mockStackMounts.slice(before)).toHaveLength(2);
  expect(mockTabs['feed/index']!.active).toBe(true);
});

it('switching tabs makes the new tab the active scene; People is the pushed kind', async () => {
  const pathname = await start('/feed');
  await fireEvent.press(await screen.findByLabelText('Lists'));
  expect(pathname()).toBe('/lists');
  expect(mockTabs['lists/index']).toEqual({ variant: 'fade', active: true });
  expect(mockTabs['feed/index']!.active).toBe(false);

  await fireEvent.press(screen.getByLabelText('Feed'));
  await fireEvent.press(await screen.findByLabelText('Find people'));
  await screen.findByRole('heading', { name: 'People' });
  expect(mockTabs['people/index']).toEqual({ variant: 'push', active: true });
});
