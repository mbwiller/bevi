import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Platform } from 'react-native';
import * as ViewShot from 'react-native-view-shot';

import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { loadReportHost } from '../loadHost';
import { setMeasureForTests } from '../pickNative';
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
let atShutter: { note: boolean; layerHidden: boolean; marks: boolean }[];

/**
 * A row of the app as React keeps it, for a touch to land on: a labelled, pressable view that a
 * `BevRow` drew on the Feed's screen (pickNative.test.ts has the shape in full). jest's own fibers
 * are not React Native's, so the touched view is handed over by hand.
 */
function rowUnderTheFinger(): object {
  const named = (name: string) => Object.defineProperty(() => null, 'name', { value: name });
  const view = { type: 'RCTView', memoizedProps: { accessibilityLabel: 'Coca-Cola', accessibilityRole: 'button', onClick: () => {} }, stateNode: { node: {} } } as Record<string, unknown>;
  const row = { type: named('BevRow'), memoizedProps: { rank: 3 }, stateNode: null, child: view } as Record<string, unknown>;
  const screenView = { type: 'RCTView', memoizedProps: {}, stateNode: { node: {} }, child: row } as Record<string, unknown>;
  const feed = { type: named('FeedScreen'), memoizedProps: {}, stateNode: null, child: screenView } as Record<string, unknown>;
  const root = { type: null, child: feed } as Record<string, unknown>;
  root.stateNode = { current: root };
  view.return = row;
  row.return = screenView;
  screenView.return = feed;
  feed.return = root;
  setMeasureForTests((element) => (element === view.stateNode ? { x: 0, y: 300, width: 402, height: 64 } : { x: 0, y: 0, width: 402, height: 874 }));
  // What a touch event names as its target: the view, holding its fiber.
  return { __internalInstanceHandle: view };
}

type TouchHandlers = Record<string, ((event: unknown) => unknown) | undefined>;
const touchRoot = (): TouchHandlers => screen.getByTestId('report-touch-root').props as TouchHandlers;
const touchAt = (target: object) => ({ target, nativeEvent: { pageX: 120, pageY: 330, touches: [{}] } });

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

type LayoutHandler = (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } | null }) => void;
type Host = { props: Record<string, unknown>; children: (Host | string)[] };

/** Every `onLayout` under `node`, the outermost first. */
function layoutHandlers(node: Host): LayoutHandler[] {
  const own = typeof node.props.onLayout === 'function' ? [node.props.onLayout as LayoutHandler] : [];
  return [...own, ...node.children.flatMap((child) => (typeof child === 'string' ? [] : layoutHandlers(child)))];
}

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
    atShutter.push({
      note: screen.queryByTestId('report-note') !== null,
      layerHidden: useLayerHidden.getState().hidden,
      marks: screen.queryByTestId('report-capture-marks') !== null,
    });
    return '/var/mobile/tmp/ReactNative/ReactNative-snapshot-image-1.jpg';
  });
});

afterEach(() => {
  setMeasureForTests(null);
  controls.resetToFixtures();
  jest.restoreAllMocks();
});

describe('the reporter is on for iOS', () => {
  it('is supported on iOS and does what the web one does, with a screenshot first and no sheets over a full-screen flow', () => {
    expect(REPORTER_SUPPORTED).toBe(true);
    expect(CAPABILITIES).toMatchObject({ select: true, steps: true, shotFirst: true, sheetsOverFullScreen: false });
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
    expect(atShutter).toEqual([{ note: false, layerHidden: true, marks: false }]);
    // And it is back, with the picture in the note.
    expect(useLayerHidden.getState().hidden).toBe(false);
    expect(useReport.getState().draft?.shots[0]?.shot?.file).toBeInstanceOf(Uint8Array);
    expect(screen.getByLabelText('Report note')).toBeTruthy();
  });

  // jest lays nothing out, so no `onLayout` ever runs here by itself. On the phone the note's first
  // layout hands every handler its event in one batch, and React Native empties each event when its
  // handler returns. A handler that leaves the reading to a state updater reads nothing, because
  // React runs the updater at the next render: that threw, and the error screen replaced the app
  // the moment the report button was pressed (BEV-35). The events are handed over here as the
  // phone hands them.
  it('survives its first layout on the phone: no handler reads a layout event after it has returned', async () => {
    await start('/feed');
    await fireEvent.press(await reportButton());
    const handlers = layoutHandlers((await screen.findByTestId('report-note')) as unknown as Host);
    // The panel itself, its header, and the two around the attach row (the one that threw).
    expect(handlers.length).toBeGreaterThanOrEqual(4);

    await act(async () => {
      handlers.forEach((onLayout, i) => {
        const event: Parameters<LayoutHandler>[0] = { nativeEvent: { layout: { x: 0, y: 44 * i, width: 390, height: 64 } } };
        onLayout(event);
        event.nativeEvent = null;
      });
    });

    expect(screen.getByTestId('report-note')).toBeTruthy();
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
  });

  it('offers the note and the four ways to attach something, as the web does', async () => {
    await start('/feed');
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select element' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Capture screen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record steps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add photos/ })).toBeTruthy();
  });

  it('Select element: a tap on the app selects what it landed on instead of pressing it, and the picture shows it outlined', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await start('/feed');
    // Nothing is listening for touches until select mode is on.
    expect(touchRoot().onStartShouldSetResponderCapture).toBeUndefined();
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    await fireEvent.press(screen.getByRole('button', { name: 'Select element' }));

    // The note steps aside and the app's root takes the next touch.
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(await screen.findByText('Tap what you mean')).toBeTruthy();
    const target = rowUnderTheFinger();
    await act(async () => {
      // Taking the touch is what keeps the row from being pressed.
      expect(touchRoot().onStartShouldSetResponderCapture!(touchAt(target))).toBe(true);
      touchRoot().onResponderRelease!(touchAt(target));
    });

    // The note is back with the component and its source file, and select mode is over.
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(screen.getByText('BevRow · app/src/components/BevRow.tsx')).toBeTruthy();
    // Wider and Narrower step through the components above it, as on the web.
    expect(screen.getByRole('button', { name: 'Wider, mark 1' })).toBeTruthy();
    expect(touchRoot().onStartShouldSetResponderCapture).toBeUndefined();

    // A second picture was taken, with the reporter hidden and the selection's outline drawn in its place.
    await waitFor(() => expect(atShutter).toHaveLength(2));
    expect(atShutter[1]).toEqual({ note: false, layerHidden: true, marks: true });
    expect(screen.queryByTestId('report-capture-marks')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('What about it?'), 'The rank badge is cut off');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    const input = report.mock.calls[0]![0];
    expect(input.targets).toHaveLength(1);
    expect(input.targets![0]).toMatchObject({
      component: 'BevRow',
      file: 'app/src/components/BevRow.tsx',
      label: 'Coca-Cola',
      rect: { x: 0, y: 300, width: 402, height: 64 },
      mark: 1,
    });
    expect(input.evidence).toHaveLength(2);
    report.mockRestore();
  });

  it('Record steps: the screens opened and the things tapped become the steps, and the app still gets every tap', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await start('/feed');
    await fireEvent.press(await reportButton());
    await screen.findByTestId('report-note');
    await fireEvent.press(screen.getByRole('button', { name: 'Record steps' }));

    expect(await screen.findByRole('button', { name: 'Stop recording steps' })).toBeTruthy();
    // It only watches: the touch is never taken from the app.
    expect(touchRoot().onStartShouldSetResponderCapture).toBeUndefined();
    const target = rowUnderTheFinger();
    await act(async () => {
      touchRoot().onTouchStartCapture!(touchAt(target));
      touchRoot().onTouchEndCapture!(touchAt(target));
    });
    expect(await screen.findByText('Recording · 2 steps')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Stop recording steps' }));
    expect(await screen.findByText('2. Tap BevRow · Coca-Cola')).toBeTruthy();
    expect(touchRoot().onTouchStartCapture).toBeUndefined();

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The row does nothing when tapped');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0]![0]).toMatchObject({ reproductionSteps: ['Start on /feed', 'Tap BevRow · Coca-Cola'], stepsSource: 'recorded' });
    report.mockRestore();
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
