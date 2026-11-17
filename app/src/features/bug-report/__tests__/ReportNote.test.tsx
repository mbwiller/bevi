import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { preparePhoto } from '@/features/create-bev/photo';
import { controls } from '@/testing/fakeApi';

import { captureScreen } from '../capture';
import type { StorageLike } from '../draft';
import { startPickMode, type PickModeHandlers } from '../pickMode';
import ReportHost from '../ReportHost';
import { openBlankNote, resetReport, setReportStorage, useReport } from '../store';
import { startStepRecording, stopStepRecording } from '../trail';
import type { PickLevel } from '../types';

// The engine is another task's; here it answers as its contract says.
jest.mock('../capture', () => ({
  captureScreen: jest.fn(async () => ({ blob: new Blob(['jpeg']), mimeType: 'image/jpeg', uri: 'blob:shot', width: 390, height: 844 })),
  releaseShot: jest.fn(),
}));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []) }));
jest.mock('../pickMode', () => ({ startPickMode: jest.fn(), isPickModeOn: jest.fn(() => false) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/feed'),
  trailSnapshot: jest.fn(() => [{ at: '2026-11-13T10:00:00.000Z', kind: 'nav', route: '/feed' }]),
  hadRecentFailure: jest.fn(() => false),
  startStepRecording: jest.fn(),
  stopStepRecording: jest.fn(() => []),
}));
jest.mock('../infer', () => ({
  inferKind: jest.fn((_n: string, s: { hasTarget: boolean }) => (s.hasTarget ? 'design' : 'bug')),
  titleFor: jest.fn((note: string, pointedAt?: string) => (pointedAt ? `${pointedAt}: ${note}` : note)),
}));
jest.mock('expo-router', () => ({ useSegments: () => ['(tabs)', 'feed'], usePathname: () => '/feed' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
// The canvas resize is browser-only; the note sees what it would return.
jest.mock('@/features/create-bev/photo', () => ({ ...jest.requireActual('@/features/create-bev/photo'), preparePhoto: jest.fn() }));

const mockLibrary = ImagePicker.launchImageLibraryAsync as jest.MockedFunction<typeof ImagePicker.launchImageLibraryAsync>;
const mockPrepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;
const mockPickMode = startPickMode as jest.MockedFunction<typeof startPickMode>;
const mockStartRec = startStepRecording as jest.MockedFunction<typeof startStepRecording>;
const mockStopRec = stopStepRecording as jest.MockedFunction<typeof stopStepRecording>;
const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** The library answers with `n` images. */
function libraryPicks(n: number) {
  mockLibrary.mockResolvedValueOnce({
    canceled: false,
    assets: Array.from({ length: n }, (_, i) => ({ uri: `blob:asset-${i}`, width: 100, height: 100, mimeType: 'image/jpeg' })),
  } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);
}

let client: QueryClient;
let photoCount = 0;

async function renderHost() {
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <QueryClientProvider client={client}>
        <ReportHost />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

async function openNote() {
  await renderHost();
  await act(async () => openBlankNote());
}

const bevd: PickLevel = {
  target: { component: 'SegmentedTabs', label: "Bev'd", file: 'app/src/components/SegmentedTabs.tsx', role: 'tab' },
  box: { x: 120, y: 200, width: 90, height: 36 },
  title: "SegmentedTabs › Bev'd",
};
const tabs: PickLevel = { target: { component: 'ListsScreen' }, box: { x: 0, y: 0, width: 390, height: 844 }, title: 'ListsScreen' };
const button = () => screen.getByTestId('report-button');

/** Add photos opens its menu; the library row leads to the picker (iOS's own sheet). */
async function fromLibrary(tile: string) {
  await fireEvent.press(screen.getByLabelText(tile));
  await fireEvent.press(screen.getByLabelText('Photo library or camera'));
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  mockLibrary.mockReset();
  mockPrepare.mockReset();
  mockPickMode.mockReset();
  mockStartRec.mockReset();
  mockStopRec.mockReset();
  mockStopRec.mockReturnValue([]);
  mockCapture.mockClear();
  photoCount = 0;
  mockPrepare.mockImplementation(async () => {
    photoCount += 1;
    return { uri: `blob:photo-${photoCount}`, blob: new Blob(['p']), mimeType: 'image/jpeg', width: 10, height: 10 };
  });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('the note: several photos (BEV-8)', () => {
  it('adds one photo, then two more; the action stops at three; removing one frees a slot; all three are filed', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await openNote();

    libraryPicks(1);
    await fromLibrary('Add photos, 3 left');
    await screen.findByLabelText('Photo 1');
    expect(mockLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3 }));

    libraryPicks(2);
    await fromLibrary('Add photos, 2 left');
    await screen.findByLabelText('Photo 3');
    expect(mockLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 2 }));
    expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(3);

    // At three the menu still opens, and both of its rows say why they are off.
    await fireEvent.press(screen.getByLabelText('Add photos, 3 pictures is the limit'));
    expect(screen.getByLabelText('Screenshot of this screen, 3 pictures is the limit').props.accessibilityState).toMatchObject({ disabled: true });
    const library = screen.getByLabelText('Photo library or camera, 3 pictures is the limit');
    expect(library.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(library);
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByTestId('note-menu-outside'));
    // Capture screen is out of pictures too.
    expect(screen.getByLabelText('Capture screen, 3 pictures is the limit').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByLabelText('Remove photo 2'));
    expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(2);
    libraryPicks(1);
    await fromLibrary('Add photos, 1 left');
    await waitFor(() => expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(3));

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The list jumps when I scroll');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    const input = report.mock.calls[0]![0];
    expect(input.evidence).toHaveLength(3);
    expect(input.evidence?.map((e) => e.caption)).toEqual(['Photo from the library', 'Photo from the library', 'Photo from the library']);
  });
});

describe('the floating button', () => {
  it('opens an empty note without capturing, and sets it aside when pressed again', async () => {
    await renderHost();
    expect(button().props.accessibilityLabel).toBe('Report');
    await fireEvent.press(button());
    expect(screen.getByTestId('report-note')).toBeTruthy();
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Half typed');
    await fireEvent.press(button());
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(screen.getByTestId('report-button-aside')).toBeTruthy();
    expect(button().props.accessibilityValue).toEqual({ text: 'Note set aside' });
    await fireEvent.press(button());
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Half typed');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('the note', () => {
  it('Send clears the panel at once; the outbox goes from sending to sent, and the toast names the ticket', async () => {
    await openNote();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The feed is blank');
    controls.setLatency(100);
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(useReport.getState().outbox.map((o) => o.status)).toEqual(['sending']);
    expect(useReport.getState().draft).toBeNull();
    expect(await screen.findByText(/^Filed T-\d+$/)).toBeTruthy();
    expect(useReport.getState().outbox.map((o) => o.status)).toEqual(['sent']);
    expect(useReport.getState().unplaced).toHaveLength(1);
  });

  it('a failed send keeps the note; pressing the button restores it and Try again uses the same key', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await openNote();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Ratings vanish after a refresh');
    controls.failNext('network', 'bugs.report');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useReport.getState().outbox[0]?.status).toBe('failed'));
    expect(screen.getByTestId('report-button-failed')).toBeTruthy();

    await fireEvent.press(button());
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Ratings vanish after a refresh');
    expect(screen.getByText("You're offline. Your note is kept.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Filed T-\d+$/);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]![0].idempotencyKey).toBe(report.mock.calls[0]![0].idempotencyKey);
  });

  it('discard asks first', async () => {
    await openNote();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Never mind');
    await fireEvent.press(screen.getByLabelText('Discard'));
    expect(screen.getByText('Discard this note?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep' }));
    expect(useReport.getState().draft?.text).toBe('Never mind');
    await fireEvent.press(screen.getByLabelText('Discard'));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(useReport.getState().draft).toBeNull();
    expect(screen.queryByTestId('report-note')).toBeNull();
  });

  it('the attached line says what goes with the note, not steps, and expands to the full list', async () => {
    await openNote();
    const line = screen.getByLabelText(/^Sent with it: /);
    expect(line.props.accessibilityLabel).not.toMatch(/step/);
    await fireEvent.press(line);
    expect(screen.getByText('Only what you see here is sent. Nothing you typed elsewhere.')).toBeTruthy();
    expect(screen.queryByText('Include recorded steps')).toBeNull();
  });
});

describe('the type dropdown', () => {
  it('opens a menu of the four types with the inferred one checked; picking one closes it and is sent', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await openNote();
    const trigger = screen.getByLabelText('Type: Bug');
    expect(trigger.props['aria-haspopup']).toBe('menu');
    // React Native folds aria-expanded into the accessibility state; react-native-web renders it back.
    expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(trigger);
    expect(screen.getByLabelText('Type: Bug').props.accessibilityState).toMatchObject({ expanded: true });
    const menu = screen.getByLabelText('Type', { exact: true });
    const rows = within(menu).getAllByLabelText(/^(Bug|Fix suggestion|Idea|Design nit)$/);
    expect(rows.map((r) => r.props.role)).toEqual(['menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemradio']);
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(['Bug', 'Fix suggestion', 'Idea', 'Design nit']);
    expect(rows.map((r) => r.props.accessibilityState?.checked)).toEqual([true, false, false, false]);

    await fireEvent.press(within(menu).getByLabelText('Idea'));
    expect(screen.queryByLabelText('Type', { exact: true })).toBeNull();
    expect(screen.getByLabelText('Type: Idea')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Could we sort by price?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]![0].kind).toBe('idea');
  });

  it('closes on a press outside it, choosing nothing', async () => {
    await openNote();
    await fireEvent.press(screen.getByLabelText('Type: Bug'));
    expect(screen.getByLabelText('Type', { exact: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('note-menu-outside'));
    expect(screen.queryByLabelText('Type', { exact: true })).toBeNull();
    expect(useReport.getState().draft?.kindOverride).toBeUndefined();
  });
});

describe('Select element', () => {
  function pickModeHandlers() {
    const stop = jest.fn();
    const box: { h?: PickModeHandlers } = {};
    mockPickMode.mockImplementation((h) => {
      box.h = h;
      return stop;
    });
    return { stop, handlers: () => box.h! };
  }

  it('steps the note aside for select mode; hover highlights, a pick marks, captures and shows the selection', async () => {
    const { stop, handlers } = pickModeHandlers();
    await openNote();
    await fireEvent.press(screen.getByLabelText('Select element'));
    expect(mockPickMode).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(screen.getByText('Tap what you mean')).toBeTruthy();
    expect(screen.queryByTestId('report-button')).toBeNull();

    await act(async () => handlers().onHover([bevd, tabs]));
    expect(screen.getByTestId('report-highlight')).toBeTruthy();
    expect(screen.getByText("SegmentedTabs › Bev'd")).toBeTruthy();

    await act(async () => handlers().onPick([bevd, tabs]));
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByText('Tap what you mean')).toBeNull();
    expect(await screen.findByLabelText("Mark 1, SegmentedTabs › Bev'd")).toBeTruthy();
    expect(screen.getByText('SegmentedTabs · app/src/components/SegmentedTabs.tsx')).toBeTruthy();
    expect(screen.getByLabelText('What about it?')).toBeTruthy();
    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith([{ box: bevd.box, n: 1 }]));
    expect(await screen.findByLabelText('Picture of /feed. Press to open.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Wider, mark 1'));
    expect(screen.getAllByText('ListsScreen').length).toBeGreaterThan(0);
  });

  it('Cancel ends select mode and brings the note back unchanged', async () => {
    const { stop } = pickModeHandlers();
    await openNote();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Kept');
    await fireEvent.press(screen.getByLabelText('Select element'));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(stop).toHaveBeenCalled();
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Kept');
    expect(useReport.getState().draft?.marks).toEqual([]);
  });

  it('says so when select mode is not available', async () => {
    mockPickMode.mockImplementation(() => {
      throw new Error('pickMode.ts: not implemented');
    });
    await openNote();
    await fireEvent.press(screen.getByLabelText('Select element'));
    expect(screen.getByTestId('report-note')).toBeTruthy();
    expect(screen.getByText("Selecting isn't available here.")).toBeTruthy();
  });
});

describe('Capture screen', () => {
  it('adds one whole-screen picture to the note, with its own remove', async () => {
    await openNote();
    await fireEvent.press(screen.getByLabelText('Capture screen'));
    expect(mockCapture).toHaveBeenCalledWith([]);
    expect(await screen.findByLabelText('Picture of /feed, whole screen. Press to open.')).toBeTruthy();
    expect(useReport.getState().draft?.shots).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText('Remove the picture of /feed, whole screen'));
    expect(useReport.getState().draft?.shots).toHaveLength(0);
  });

  it('every press adds a new picture: two of one screen are both kept and both sent, numbered', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await openNote();
    await fireEvent.press(screen.getByLabelText('Capture screen'));
    await screen.findByLabelText('Picture of /feed, whole screen. Press to open.');
    await fireEvent.press(screen.getByLabelText('Capture screen'));
    expect(await screen.findByLabelText('Picture of /feed, whole screen (2). Press to open.')).toBeTruthy();
    expect(mockCapture).toHaveBeenCalledTimes(2);
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The sheet covers the button');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]![0].evidence?.map((e) => e.caption)).toEqual(['/feed, whole screen', '/feed, whole screen (2)']);
  });

  it('stays available after Select element and adds a second picture beside the marked one', async () => {
    const stop = jest.fn();
    let handlers: PickModeHandlers | undefined;
    mockPickMode.mockImplementation((h) => {
      handlers = h;
      return stop;
    });
    await openNote();
    await fireEvent.press(screen.getByLabelText('Select element'));
    await act(async () => handlers!.onPick([bevd]));
    await screen.findByLabelText('Picture of /feed. Press to open.');
    const capture = screen.getByLabelText('Capture screen');
    expect(capture.props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(capture);
    expect(await screen.findByLabelText('Picture of /feed, whole screen. Press to open.')).toBeTruthy();
    expect(useReport.getState().draft?.shots.map((x) => x.kind)).toEqual(['marked', 'screen']);
    // The marked picture is still the one with the mark.
    expect(screen.getByLabelText("Mark 1, SegmentedTabs › Bev'd")).toBeTruthy();
  });

  it('shows the shimmer while it runs, and a failed one leaves no placeholder and says so', async () => {
    let land: (shot: null) => void = () => {};
    mockCapture.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
    await openNote();
    await fireEvent.press(screen.getByLabelText('Capture screen'));
    expect(screen.getByLabelText('Taking the picture')).toBeTruthy();
    await act(async () => land(null));
    expect(screen.queryByLabelText('Taking the picture')).toBeNull();
    expect(useReport.getState().draft?.shots).toEqual([]);
    expect(screen.getByText("Couldn't take a picture of this screen.")).toBeTruthy();
  });
});

describe('the Add photos menu', () => {
  it('opens under the tile with two rows; the screenshot row adds a picture without the picker', async () => {
    await openNote();
    const tile = screen.getByLabelText('Add photos, 3 left');
    expect(tile.props['aria-haspopup']).toBe('menu');
    expect(tile.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(tile);
    expect(screen.getByLabelText('Add photos, 3 left').props.accessibilityState).toMatchObject({ expanded: true });
    const menu = screen.getByLabelText('Add photos', { exact: true });
    const rows = within(menu).getAllByLabelText(/^(Screenshot of this screen|Photo library or camera)$/);
    expect(rows.map((r) => r.props.role)).toEqual(['menuitem', 'menuitem']);
    await fireEvent.press(within(menu).getByLabelText('Screenshot of this screen'));
    expect(screen.queryByLabelText('Add photos', { exact: true })).toBeNull();
    expect(mockCapture).toHaveBeenCalledWith([]);
    expect(mockLibrary).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Picture of /feed, whole screen. Press to open.')).toBeTruthy();
    expect(screen.getByLabelText('Add photos, 2 left')).toBeTruthy();
  });

  it('the library row opens the picker; a press outside closes the menu', async () => {
    await openNote();
    await fireEvent.press(screen.getByLabelText('Add photos, 3 left'));
    await fireEvent.press(screen.getByTestId('note-menu-outside'));
    expect(screen.queryByLabelText('Add photos', { exact: true })).toBeNull();
    libraryPicks(1);
    await fromLibrary('Add photos, 3 left');
    expect(await screen.findByLabelText('Photo 1')).toBeTruthy();
    expect(mockLibrary).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('Record steps', () => {
  it('records from a start the tester chose until Stop; the steps go into the note and are sent', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    let onStep: ((steps: string[]) => void) | undefined;
    mockStartRec.mockImplementation((_route, cb) => {
      onStep = cb;
      cb?.(['Start on /feed']);
    });
    await openNote();
    await fireEvent.press(screen.getByLabelText('Record steps'));
    expect(mockStartRec).toHaveBeenCalledWith('/feed', expect.any(Function));
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(button().props.accessibilityLabel).toBe('Stop recording steps');
    expect(screen.getByTestId('report-button-stop')).toBeTruthy();
    expect(screen.getByText('Recording · 1 step')).toBeTruthy();

    await act(async () => onStep!(['Start on /feed', 'Open /lists', "Tap SegmentedTabs › Bev'd"]));
    expect(screen.getByText('Recording · 3 steps')).toBeTruthy();

    mockStopRec.mockReturnValueOnce(['Start on /feed', 'Open /lists', "Tap SegmentedTabs › Bev'd"]);
    await fireEvent.press(button());
    expect(screen.getByTestId('report-note')).toBeTruthy();
    expect(screen.getByText('1. Start on /feed')).toBeTruthy();
    expect(screen.getByText("3. Tap SegmentedTabs › Bev'd")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), "Bev'd shows the wrong count");
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]![0]).toMatchObject({
      reproductionSteps: ['Start on /feed', 'Open /lists', "Tap SegmentedTabs › Bev'd"],
      stepsSource: 'recorded',
    });
  });

  it('"Record again" starts over and "Remove steps" clears them; with no recording no steps are sent', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await openNote();
    await fireEvent.press(screen.getByLabelText('Record steps'));
    mockStopRec.mockReturnValueOnce(['Start on /feed', 'Open /lists']);
    await fireEvent.press(button());
    expect(screen.getByText('2. Open /lists')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Record again' }));
    expect(mockStartRec).toHaveBeenCalledTimes(2);
    expect(button().props.accessibilityLabel).toBe('Stop recording steps');
    mockStopRec.mockReturnValueOnce(['Start on /feed']);
    await fireEvent.press(button());
    expect(screen.queryByText('2. Open /lists')).toBeNull();
    expect(screen.getByText('1. Start on /feed')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove steps' }));
    expect(screen.queryByTestId('report-steps')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'No steps here');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]![0].reproductionSteps).toBeUndefined();
    expect(report.mock.calls[0]![0].stepsSource).toBeUndefined();
  });

  it('says when the 30-step limit is reached', async () => {
    let onStep: ((steps: string[]) => void) | undefined;
    mockStartRec.mockImplementation((_route, cb) => {
      onStep = cb;
    });
    await openNote();
    await fireEvent.press(screen.getByLabelText('Record steps'));
    await act(async () => onStep!(Array.from({ length: 30 }, (_, i) => `Open /s${i}`)));
    expect(screen.getByText('Recording · 30 steps')).toBeTruthy();
    expect(screen.getByText('30 steps is the limit')).toBeTruthy();
  });
});

describe('the host going away (sign-out, the reporter role taken away)', () => {
  it('ends select mode with it, so no select-mode listener outlives the banner', async () => {
    const stop = jest.fn();
    mockPickMode.mockImplementation(() => stop);
    const view = await renderHost();
    await act(async () => openBlankNote());
    await fireEvent.press(screen.getByLabelText('Select element'));
    expect(useReport.getState().selecting).toBe(true);
    await act(async () => view.unmount());
    expect(stop).toHaveBeenCalled();
    expect(useReport.getState()).toMatchObject({ selecting: false, picking: null });
  });

  it('stops and discards a recording, so a host mounted later never shows Stop', async () => {
    mockStopRec.mockReturnValue(['Start on /feed', 'Open /lists']);
    const view = await renderHost();
    await act(async () => openBlankNote());
    await fireEvent.press(screen.getByLabelText('Record steps'));
    expect(useReport.getState().recording).not.toBeNull();
    await act(async () => view.unmount());
    expect(mockStopRec).toHaveBeenCalled();
    expect(useReport.getState().recording).toBeNull();
    expect(useReport.getState().draft?.steps).toEqual([]);
    await renderHost();
    expect(screen.getByTestId('report-button').props.accessibilityLabel).not.toBe('Stop recording steps');
  });
});
