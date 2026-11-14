import path from 'path';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { useSession, type SessionStatus } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { captureScreen } from '../capture';
import type { StorageLike } from '../draft';
import { pickAt } from '../pick';
import { DOCK_STRIP, LONG_PRESS_MS, TIP_ABOVE } from '../ReportDrop';
import { resetReport, setReportStorage, useReport } from '../store';
import type { PickLevel } from '../types';

// The real route tree and root layout, so the drop is checked where the app mounts it.
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
jest.mock('@/features/bug-report/trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn((segments: string[]) => `/${segments.filter((s) => !s.startsWith('(')).join('/')}`),
  trailSnapshot: jest.fn(() => []),
  recordedSteps: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
}));
jest.mock('@/features/bug-report/infer', () => ({
  inferKind: jest.fn(() => 'bug'),
  titleFor: jest.fn((note: string) => note),
}));

const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;
const mockPick = pickAt as jest.MockedFunction<typeof pickAt>;

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

const drop = () => screen.getByTestId('report-drop');
const point = (x: number, y: number) => ({ nativeEvent: { clientX: x, clientY: y, pointerId: 1 } });

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  mockCapture.mockClear();
  mockPick.mockReset();
  mockPick.mockReturnValue([]);
});

afterEach(() => controls.resetToFixtures());

describe('where the drop shows', () => {
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

  it('on a tab screen for an internal reporter, and no header action any more', async () => {
    await start('ready', '/feed');
    const button = await screen.findByLabelText('Report');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityHint).toBe('Drag onto something to point at it, or press to capture the screen');
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('on a full-screen flow (/rank/…), where there was no entry before', async () => {
    const path = await start('ready', '/rank/some-bev');
    expect(await screen.findByLabelText('Report')).toBeTruthy();
    expect(path()).toBe('/rank/some-bev');
  });

  it('on the not-found page', async () => {
    await start('ready', '/no/such/page');
    await screen.findByText('Page not found');
    expect(await screen.findByLabelText('Report')).toBeTruthy();
  });
});

describe('pressing and holding the drop', () => {
  it('a press with no note captures the whole screen and opens the note', async () => {
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerUp', point(371, 601));
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(mockCapture).toHaveBeenCalledWith([]);
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
    expect(useReport.getState().draft?.marks).toEqual([]);
  });

  it('a press with a note set aside reopens it, without another capture', async () => {
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerUp', point(370, 600));
    await fireEvent.changeText(await screen.findByLabelText("What's going on?"), 'Blank feed');
    await fireEvent.press(screen.getByLabelText('Set aside'));
    expect(screen.queryByTestId('report-note')).toBeNull();
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerUp', point(370, 600));
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Blank feed');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('a long press opens Your reports', async () => {
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await act(async () => {
      jest.advanceTimersByTime(LONG_PRESS_MS + 50);
    });
    await fireEvent(drop(), 'pointerUp', point(370, 600));
    expect(await screen.findByText('Your reports')).toBeTruthy();
    expect(useReport.getState().draft).toBeNull();
  });
});

describe('dragging the drop', () => {
  const tabBarAdd: PickLevel = {
    target: { component: 'TabBar', label: 'Add Bev', role: 'button' },
    box: { x: 150, y: 780, width: 90, height: 49 },
    title: 'TabBar › Add Bev',
  };

  it('lights up what is under its tip, and letting go marks it and opens the note', async () => {
    mockPick.mockReturnValue([tabBarAdd]);
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerMove', point(200, 830));
    await waitFor(() => expect(screen.getByTestId('report-highlight')).toBeTruthy());
    expect(screen.getByText('TabBar › Add Bev')).toBeTruthy();
    await fireEvent(drop(), 'pointerUp', point(200, 830));
    // The tip rides above the finger: that is the point picked.
    expect(mockPick).toHaveBeenLastCalledWith(200, 830 - TIP_ABOVE);
    expect(await screen.findByLabelText('Mark 1, TabBar › Add Bev')).toBeTruthy();
    expect(screen.getByLabelText('What about it?')).toBeTruthy();
    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith([{ box: tabBarAdd.box, n: 1 }]));
  });

  it('let go in the strip along an edge, it docks there and marks nothing', async () => {
    mockPick.mockReturnValue([tabBarAdd]);
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerMove', point(DOCK_STRIP - 10, 400));
    await fireEvent(drop(), 'pointerUp', point(DOCK_STRIP - 10, 400));
    expect(useReport.getState().dock?.side).toBe('left');
    expect(useReport.getState().draft).toBeNull();
    expect(screen.queryByTestId('report-highlight')).toBeNull();
  });

  it('let go over nothing pickable, nothing happens', async () => {
    await start('ready', '/feed');
    await screen.findByLabelText('Report');
    await fireEvent(drop(), 'pointerDown', point(370, 600));
    await fireEvent(drop(), 'pointerMove', point(200, 300));
    await fireEvent(drop(), 'pointerUp', point(200, 300));
    expect(useReport.getState().draft).toBeNull();
    expect(screen.queryByTestId('report-note')).toBeNull();
  });
});

describe('Settings, Internal', () => {
  it('"Report a bug" opens a new note without a capture; "My reports" opens the sheet', async () => {
    await start('ready', '/settings');
    await screen.findByLabelText('Report');
    await fireEvent.press(await screen.findByLabelText('Report a bug'));
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    expect(mockCapture).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Set aside'));
    await fireEvent.press(screen.getByLabelText('My reports'));
    expect(await screen.findByText('Your reports')).toBeTruthy();
  });

  it('the old /report-bug link opens a note and goes back', async () => {
    const path = await start('ready', '/report-bug');
    expect(await screen.findByTestId('report-note')).toBeTruthy();
    await waitFor(() => expect(path()).toBe('/feed'));
  });
});
