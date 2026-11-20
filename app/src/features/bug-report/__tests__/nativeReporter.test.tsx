import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Platform } from 'react-native';
import * as ViewShot from 'react-native-view-shot';

import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { loadReportHost } from '../loadHost';
import { CAPABILITIES } from '../capabilities';
import { REPORTER_SUPPORTED } from '../supported';
import { useLayerHidden } from '../layerHidden';
import { resetReport, setReportStorage, useReport } from '../store';
import type { StorageLike } from '../draft';
import { useReportCommands } from '../commands';

// The iOS app, end to end through the real route tree and root layout (jest resolves modules as
// iOS; jest.setup.js's web stand-ins for `supported` and `capabilities` are undone). Only the two
// native modules are replaced: the window screenshot and the file system its bytes are read with.

jest.unmock('../supported');
jest.unmock('../capabilities');
jest.setTimeout(60_000);

const APP_DIR = path.resolve(__dirname, '../../../app');

// jest can't run a dynamic import(); the layout's lazy loader gets the module directly, and counts
// how often anything asked for the reporter's code.
jest.mock('../loadHost', () => ({
  loadReportHost: jest.fn(() => Promise.resolve({ default: require('../ReportHost').default })),
}));
const mockLoad = loadReportHost as jest.MockedFunction<typeof loadReportHost>;

jest.mock('react-native-view-shot', () => ({ captureScreen: jest.fn(), releaseCapture: jest.fn() }));
const shoot = ViewShot.captureScreen as jest.MockedFunction<typeof ViewShot.captureScreen>;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
jest.mock('expo-file-system', () => ({
  File: class {
    bytes() {
      return Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]));
    }
  },
}));

/** What was on screen at the moment of the shutter. */
let atShutter: { note: boolean; layerHidden: boolean }[];

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

async function start(initialUrl: string, status: 'ready' | 'onboarding' = 'ready') {
  useSession.setState({ status, profile: undefined, checked: true, devForced: true });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

/** `bugs.canReport` has answered and the lazy host has had its turn, so an absence is real (renderRouter uses fake timers). */
async function settled() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
  }
}

const reportButton = () => screen.findByRole('button', { name: 'Report' });

beforeEach(() => {
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue('18.2');
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  useReportCommands.setState({ pending: null });
  useLayerHidden.setState({ hidden: false });
  mockLoad.mockClear();
  atShutter = [];
  shoot.mockReset();
  shoot.mockImplementation(async () => {
    atShutter.push({ note: screen.queryByTestId('report-note') !== null, layerHidden: useLayerHidden.getState().hidden });
    return '/var/mobile/tmp/ReactNative/ReactNative-snapshot-image-1.jpg';
  });
});

afterEach(() => {
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

describe('the reporter is on for iOS, in its stage 1 shape', () => {
  it('is supported on iOS, with a screenshot and a note and nothing that is the DOM', () => {
    expect(REPORTER_SUPPORTED).toBe(true);
    expect(CAPABILITIES).toMatchObject({ select: false, steps: false, shotFirst: true, sheetsOverFullScreen: false });
  });
});

describe('who gets the reporter', () => {
  it('an internal reporter gets the report button, once the session is ready', async () => {
    const canReport = jest.spyOn(api.bugs, 'canReport');
    await start('/feed');
    const button = await reportButton();
    expect(button.props.accessibilityHint).toBe('Opens the bug report note');
    expect(canReport).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalled();
    canReport.mockRestore();
  });

  it('an ordinary account is asked about, gets no button, and the reporter\'s code is never asked for', async () => {
    controls.setInternalReporter(false);
    const canReport = jest.spyOn(api.bugs, 'canReport');
    await start('/feed');
    await screen.findAllByText('Your feed');
    await settled();
    expect(canReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Report')).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
    canReport.mockRestore();
  });

  it('nobody is asked before the session is ready', async () => {
    const canReport = jest.spyOn(api.bugs, 'canReport');
    await start('/onboarding/profile', 'onboarding');
    await screen.findAllByText('Your profile');
    await settled();
    expect(canReport).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Report')).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
    canReport.mockRestore();
  });

  it("shows an internal reporter's Settings the Internal rows, and an ordinary account's not", async () => {
    await start('/settings');
    expect(await screen.findByText('Report a bug')).toBeTruthy();
    expect(screen.getByText('Filed reports')).toBeTruthy();
  });

  it("leaves the Internal rows out of an ordinary account's Settings", async () => {
    controls.setInternalReporter(false);
    await start('/settings');
    await screen.findByText('Sign out');
    await settled();
    expect(screen.queryByText('Report a bug')).toBeNull();
    expect(screen.queryByText('Filed reports')).toBeNull();
  });
});

describe('reporting from the app', () => {
  it('takes the screenshot before the reporter is on screen, then opens the note with it', async () => {
    await start('/feed');
    await fireEvent.press(await reportButton());
    expect(await screen.findByTestId('report-note')).toBeTruthy();

    // At the shutter the note was not up, and the reporter's own layer was hidden.
    expect(atShutter).toEqual([{ note: false, layerHidden: true }]);
    // And it is back, with the picture in the note.
    expect(useLayerHidden.getState().hidden).toBe(false);
    expect(useReport.getState().draft?.shots[0]?.shot?.file).toBeInstanceOf(Uint8Array);
    expect(screen.getByLabelText('Report note')).toBeTruthy();
  });

  it('offers the note, a screenshot and photos; no Select element and no Record steps', async () => {
    await start('/feed');
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Capture screen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add photos/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Select element/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Record steps/ })).toBeNull();
  });

  it('sends the note with the screenshot as bytes and what the app sends by itself, and says it was filed', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await start('/feed');
    await fireEvent.press(await reportButton());
    const field = await screen.findByLabelText("What's going on?");
    await fireEvent.changeText(field, 'The feed shows an old post first');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    const input = report.mock.calls[0]![0];
    expect(input.description).toBe('The feed shows an old post first');
    expect(input.evidence).toHaveLength(1);
    expect(input.evidence![0]!.file).toBeInstanceOf(Uint8Array);
    expect([...(input.evidence![0]!.file as Uint8Array)]).toEqual([...JPEG]);
    expect(input.targets).toBeUndefined();
    expect(input.reproductionSteps).toBeUndefined();
    expect(input.environment).toMatchObject({ route: '/feed', platform: expect.stringMatching(/^ios/), osVersion: 'iOS 18.2' });
    expect(await screen.findByText(/Filed T-/)).toBeTruthy();
    report.mockRestore();
  });

  it('a screenshot that cannot be taken costs the picture, not the report', async () => {
    shoot.mockRejectedValue(new Error('The view cannot be captured'));
    const report = jest.spyOn(api.bugs, 'report');
    await start('/feed');
    await fireEvent.press(await reportButton());
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(await screen.findByText("Couldn't take a picture of this screen.")).toBeTruthy();
    expect(useLayerHidden.getState().hidden).toBe(false);

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The feed is slow');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0]![0].evidence).toBeUndefined();
    report.mockRestore();
  });

  it('a send that fails (offline) keeps the note and the picture, and Try again files it once', async () => {
    controls.failNext('network', 'bugs.report');
    const report = jest.spyOn(api.bugs, 'report');
    await start('/feed');
    await fireEvent.press(await reportButton());
    await fireEvent.changeText(await screen.findByLabelText("What's going on?"), 'It will not load');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    // The red dot says a report didn't send; pressing the button brings the note back with its error.
    expect(await screen.findByTestId('report-button-failed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByDisplayValue('It will not load')).toBeTruthy();
    expect(useReport.getState().draft?.shots[0]?.shot).not.toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Filed T-/)).toBeTruthy();
    expect(report).toHaveBeenCalledTimes(2);
    // The same key both times: one ticket.
    expect(report.mock.calls[1]![0].idempotencyKey).toBe(report.mock.calls[0]![0].idempotencyKey);
    report.mockRestore();
  });

  it('opens from Settings with a picture of Settings', async () => {
    await start('/settings');
    await fireEvent.press(await screen.findByText('Report a bug'));
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(atShutter).toHaveLength(1);
    expect(useReport.getState().draft?.shots[0]?.route).toBe('/settings');
  });

  it('/report-bug goes straight back and opens a note with no picture: the screen behind it is not the one reported', async () => {
    const path = await start('/report-bug');
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(path()).toBe('/feed');
    expect(shoot).not.toHaveBeenCalled();
    expect(useReport.getState().draft?.shots).toEqual([]);
  });
});

describe('over a full-screen flow', () => {
  it('the button and the note are there, above the ranking modal', async () => {
    const path = await start('/rank/some-bev');
    await fireEvent.press(await reportButton());
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(path()).toBe('/rank/some-bev');
    expect(useReport.getState().draft?.shots[0]?.route).toBe('/rank/[bevId]');
  });

  it('Filed reports stays shut there, and the note says why', async () => {
    await start('/rank/some-bev');
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    await waitFor(() => expect(useReport.getState().onFullScreen).toBe(true));
    await fireEvent.press(screen.getByRole('button', { name: 'Filed reports' }));
    expect(await screen.findByText("Filed reports open from the app's other screens, not from here.")).toBeTruthy();
    expect(useReport.getState().sheet).toBeNull();
  });

  it('Filed reports opens everywhere else', async () => {
    await start('/feed');
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    await fireEvent.press(screen.getByRole('button', { name: 'Filed reports' }));
    await waitFor(() => expect(useReport.getState().sheet).toBe('reports'));
  });
});
