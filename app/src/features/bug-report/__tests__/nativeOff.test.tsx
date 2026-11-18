import path from 'path';

import { act, renderRouter, screen } from 'expo-router/testing-library';
import { render } from '@testing-library/react-native';
import { createElement } from 'react';
import { Platform } from 'react-native';

import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { loadReportHost } from '../loadHost';
import { REPORTER_SUPPORTED } from '../supported';

// The native app (jest resolves as iOS): the real `supported` module, not jest.setup.js's stand-in,
// and the real loadHost.ts, which is the file iOS bundles.
jest.unmock('@/features/bug-report/supported');

const APP_DIR = path.resolve(__dirname, '../../../app');

async function start(initialUrl: string) {
  useSession.setState({ status: 'ready', profile: undefined, checked: true, devForced: true });
  await renderRouter(APP_DIR, { initialUrl });
}

/** `bugs.canReport` would have answered and the lazy host had its turn (renderRouter uses fake timers). */
async function settled() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
  }
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  // An internal reporter: on the web this account gets the button and the Settings rows.
  controls.setInternalReporter(true);
});

afterEach(() => controls.resetToFixtures());

it('is off wherever the platform is not the web', () => {
  expect(Platform.OS).toBe('ios');
  expect(REPORTER_SUPPORTED).toBe(false);
});

it('shows an internal reporter no report button, and never asks the server', async () => {
  const canReport = jest.spyOn(api.bugs, 'canReport');
  await start('/feed');
  await screen.findAllByText('Your feed');
  await settled();
  expect(screen.queryByLabelText('Report')).toBeNull();
  expect(canReport).not.toHaveBeenCalled();
  canReport.mockRestore();
});

it("leaves the Internal rows out of an internal reporter's Settings", async () => {
  await start('/settings');
  await screen.findByText('Sign out');
  await settled();
  expect(screen.queryByText('Report a bug')).toBeNull();
  expect(screen.queryByText('Filed reports')).toBeNull();
});

it('/report-bug goes straight back without opening a note', async () => {
  await start('/report-bug');
  await settled();
  await screen.findAllByText('Your feed');
  expect(screen.queryByTestId('report-note')).toBeNull();
});

it('the loader the native app bundles gives a component that draws nothing', async () => {
  const { default: Host } = await loadReportHost();
  const view = await render(createElement(Host));
  expect(view.toJSON()).toBeNull();
});
