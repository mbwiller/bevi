import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { useSession, type SessionStatus } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { captureScreen } from '../capture';
import { requestReport, useReportCommands } from '../commands';
import type { StorageLike } from '../draft';
import { resetReport, setReportStorage, useReport } from '../store';

// The real route tree and root layout, so the button is checked where the app mounts it.
const APP_DIR = path.resolve(__dirname, '../../../app');

// jest can't run a dynamic import(); the layout's lazy loader gets the module directly.
jest.mock('@/features/bug-report/loadHost', () => ({
  loadReportHost: () => Promise.resolve({ default: require('@/features/bug-report/ReportHost').default }),
}));
// The engine is another task's; here it answers as its contract says.
jest.mock('@/features/bug-report/capture', () => ({
  captureScreen: jest.fn(async () => ({ blob: new Blob(['jpeg']), mimeType: 'image/jpeg', uri: 'blob:shot', width: 390, height: 844 })),
  releaseShot: jest.fn(),
}));
jest.mock('@/features/bug-report/pick', () => ({ pickAt: jest.fn(() => []), pickScreen: jest.fn(() => null) }));
jest.mock('@/features/bug-report/pickMode', () => ({ startPickMode: jest.fn(() => () => {}), isPickModeOn: jest.fn(() => false) }));
jest.mock('@/features/bug-report/trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn((segments: string[]) => `/${segments.filter((s) => !s.startsWith('(')).join('/')}`),
  trailSnapshot: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
  startStepRecording: jest.fn(),
  stopStepRecording: jest.fn(() => []),
  isRecordingSteps: jest.fn(() => false),
}));
jest.mock('@/features/bug-report/infer', () => ({
  inferKind: jest.fn(() => 'bug'),
  titleFor: jest.fn((note: string) => note),
}));

const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

async function start(status: SessionStatus, initialUrl: string) {
  useSession.setState({ status, profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

/**
 * `bugs.canReport` has answered and the lazy host has had its turn, so an absence is real.
 * (renderRouter switches jest to fake timers.)
 */
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
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  useReportCommands.setState({ pending: null });
  mockCapture.mockClear();
});

afterEach(() => controls.resetToFixtures());

describe('where the button shows', () => {
  it('not for an ordinary account', async () => {
    controls.setInternalReporter(false);
    await start('ready', '/feed');
    await screen.findAllByText('Your feed');
    await settled();
    expect(screen.queryByLabelText('Report')).toBeNull();
  });

  it('not before the session is ready, and canReport is not even asked', async () => {
    const canReport = jest.spyOn(api.bugs, 'canReport');
    await start('onboarding', '/onboarding/profile');
    await screen.findAllByText('Your profile');
    await settled();
    expect(screen.queryByLabelText('Report')).toBeNull();
    expect(canReport).not.toHaveBeenCalled();
    canReport.mockRestore();
  });

  it('on a tab screen for an internal reporter: a plain button with the alert icon, and no header action', async () => {
    await start('ready', '/feed');
    const button = await screen.findByRole('button', { name: 'Report' });
    expect(button.props.accessibilityHint).toBe('Opens the bug report note');
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('on a full-screen flow (/rank/…), where there was no entry before', async () => {
    const path = await start('ready', '/rank/some-bev');
    expect(await screen.findByRole('button', { name: 'Report' })).toBeTruthy();
    expect(path()).toBe('/rank/some-bev');
  });

  it('on the not-found page', async () => {
    await start('ready', '/no/such/page');
    await screen.findByText('Page not found');
    expect(await screen.findByRole('button', { name: 'Report' })).toBeTruthy();
  });
});

describe('pressing the button', () => {
  it('opens an empty note and never captures; pressing it again sets the note aside', async () => {
    await start('ready', '/feed');
    await fireEvent.press(await screen.findByRole('button', { name: 'Report' }));
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
    expect(useReport.getState().draft?.shots).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(useReport.getState().draft).not.toBeNull();
    await settled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('the triangle is an outline with no note and filled while one is in progress, open or set aside', async () => {
    await start('ready', '/feed');
    await screen.findByRole('button', { name: 'Report' });
    expect(screen.queryByTestId('report-button-filled')).toBeNull();

    // Open.
    await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByTestId('report-button-filled')).toBeTruthy();

    // Set aside: still filled, and the dot is there too.
    await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
    expect(screen.getByTestId('report-button-filled')).toBeTruthy();
    expect(screen.getByTestId('report-button-aside')).toBeTruthy();

    // Discarded: back to the outline.
    await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
    await fireEvent.press(await screen.findByLabelText('Discard'));
    await fireEvent.press(await screen.findByText('Discard'));
    expect(screen.queryByTestId('report-button-filled')).toBeNull();
  });
});

describe('Settings, Internal, and the old link', () => {
  it('"Report a bug" opens a new note without a capture; "My reports" opens the sheet', async () => {
    await start('ready', '/settings');
    await screen.findByRole('button', { name: 'Report' });
    await fireEvent.press(await screen.findByLabelText('Report a bug'));
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(mockCapture).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Set aside'));
    await fireEvent.press(screen.getByLabelText('My reports'));
    expect(await screen.findByText('Filed reports')).toBeTruthy();
  });

  it('the old /report-bug link opens a note and goes back', async () => {
    const path = await start('ready', '/report-bug');
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    await waitFor(() => expect(path()).toBe('/feed'));
  });

  it('for an ordinary account /report-bug asks for nothing and a stray request is dropped, never kept for the next tester', async () => {
    controls.setInternalReporter(false);
    const path = await start('ready', '/report-bug');
    await waitFor(() => expect(path()).toBe('/feed'));
    await settled();
    expect(useReportCommands.getState().pending).toBeNull();

    await act(async () => requestReport('note'));
    await settled();
    expect(useReportCommands.getState().pending).toBeNull();
    expect(screen.queryByTestId('report-note')).toBeNull();
  });
});
