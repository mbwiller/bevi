import path from 'path';

import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { captureError } from '@/lib/crashReporting';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

// A screen that throws while it renders, in the real app: the real root layout (src/app/_layout.tsx)
// and its `ErrorBoundary` export, with one route replaced by one that throws. Without the export
// the error leaves the tree, which fails the render here and closes the app on a phone.

// jest can't run a dynamic import(); the root layout's lazy chunks get their modules directly.
jest.mock('@/features/bug-report/loadHost', () => ({
  loadReportHost: () => Promise.resolve({ default: require('@/features/bug-report/ReportHost').default }),
}));
jest.mock('@/features/create-bev/loadNutritionDemo', () => ({
  loadNutritionDemo: () => Promise.resolve({ default: require('@/features/create-bev/NutritionDemo').NutritionDemo }),
}));
// Everything crash reporting does in the layout stays real (it is off: no suite has a DSN). Only
// what the boundary hands it is watched.
jest.mock('@/lib/crashReporting', () => ({
  ...jest.requireActual<typeof import('@/lib/crashReporting')>('@/lib/crashReporting'),
  captureError: jest.fn(),
}));

const APP_DIR = path.resolve(__dirname, '../app');
const capture = captureError as jest.MockedFunction<typeof captureError>;
/** What the boundary reported, apart from anything a failed read reported on the way. */
const rendered = () => capture.mock.calls.filter(([, context]) => context?.source === 'render');

let broken: boolean;
const failure = new TypeError("Cannot read properties of undefined (reading 'map')");

/** Stands in for Settings: throws while `broken`, and is an ordinary screen once it is not. */
function Thrower() {
  if (broken) throw failure;
  return <Text>Settings, working</Text>;
}

async function start(initialUrl: string) {
  useSession.setState({ status: 'ready', profile: undefined, checked: true, devForced: true });
  const result = renderRouter({ appDir: APP_DIR, overrides: { 'settings/index': Thrower } }, { initialUrl });
  await result;
  return () => result.getPathname();
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  capture.mockClear();
  broken = true;
  // React logs every error a boundary catches; that is the subject here, not noise to read.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  controls.resetToFixtures();
});

it('shows the message instead of crashing, and none of the app around it', async () => {
  const pathname = await start('/settings');
  expect(await screen.findByText('Something went wrong')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  // The boundary replaces the root layout: no screen, no tab bar, and the error itself is not shown.
  expect(screen.queryByText('Settings, working')).toBeNull();
  expect(screen.queryByLabelText('Main')).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toContain('Cannot read');
  expect(pathname()).toBe('/settings');
});

it('reports the error once', async () => {
  await start('/settings');
  await screen.findByText('Something went wrong');
  expect(rendered()).toEqual([[failure, { source: 'render' }]]);
});

it('"Try again" mounts the app afresh on the same route', async () => {
  const pathname = await start('/settings');
  await screen.findByText('Something went wrong');
  broken = false;
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Settings, working')).toBeTruthy();
  expect(screen.queryByText('Something went wrong')).toBeNull();
  expect(pathname()).toBe('/settings');
  expect(rendered()).toHaveLength(1);
});

it('shows the message again, and reports again, when the screen is still broken', async () => {
  await start('/settings');
  await screen.findByText('Something went wrong');
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Something went wrong')).toBeTruthy();
  expect(rendered()).toHaveLength(2);
});

it('leaves a screen that does not throw alone', async () => {
  broken = false;
  await start('/settings');
  expect(await screen.findByText('Settings, working')).toBeTruthy();
  expect(screen.queryByText('Something went wrong')).toBeNull();
  expect(rendered()).toEqual([]);
});
