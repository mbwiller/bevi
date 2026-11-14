import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { preparePhoto } from '@/features/create-bev/photo';
import { controls } from '@/testing/fakeApi';

import { captureScreen } from '../capture';
import type { StorageLike } from '../draft';
import ReportHost from '../ReportHost';
import { markLevels, openBlankNote, resetReport, setReportStorage, useReport } from '../store';
import type { PickLevel } from '../types';

// The engine is another task's; here it answers as its contract says.
jest.mock('../capture', () => ({
  captureScreen: jest.fn(async () => ({ blob: new Blob(['jpeg']), mimeType: 'image/jpeg', uri: 'blob:shot', width: 390, height: 844 })),
  releaseShot: jest.fn(),
}));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []), pickScreen: jest.fn(() => null) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/feed'),
  trailSnapshot: jest.fn(() => [{ at: '2026-11-13T10:00:00.000Z', kind: 'nav', route: '/feed' }]),
  recordedSteps: jest.fn(() => ['Open /feed', 'Tap TabBar › Lists']),
  hadRecentFailure: jest.fn(() => false),
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

const level = (title: string): PickLevel => ({ target: { component: 'TabBar', label: title }, box: { x: 10, y: 700, width: 80, height: 44 }, title });
const drop = () => screen.getByTestId('report-drop');

async function pressDrop() {
  await fireEvent(drop(), 'pointerDown', { nativeEvent: { clientX: 370, clientY: 600, pointerId: 1 } });
  await fireEvent(drop(), 'pointerUp', { nativeEvent: { clientX: 370, clientY: 600, pointerId: 1 } });
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
  it('adds one photo, then two more; the tile stops at three; removing one frees a slot; all three are filed', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await renderHost();
    await act(async () => openBlankNote());

    libraryPicks(1);
    await fireEvent.press(screen.getByLabelText('Add photos, 3 left'));
    await screen.findByLabelText('Photo 1');
    expect(mockLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3 }));

    libraryPicks(2);
    await fireEvent.press(screen.getByLabelText('Add photos, 2 left'));
    await screen.findByLabelText('Photo 3');
    expect(mockLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 2 }));
    expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(3);

    const full = screen.getByLabelText('Add photos, 3 pictures is the limit');
    expect(full.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(full);
    expect(mockLibrary).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByLabelText('Remove photo 2'));
    expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(2);
    libraryPicks(1);
    await fireEvent.press(screen.getByLabelText('Add photos, 1 left'));
    await waitFor(() => expect(screen.getAllByLabelText(/^Photo \d$/)).toHaveLength(3));

    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The list jumps when I scroll');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    const input = report.mock.calls[0]![0];
    expect(input.evidence).toHaveLength(3);
    expect(input.evidence?.map((e) => e.caption)).toEqual(['Photo from the library', 'Photo from the library', 'Photo from the library']);
  });
});

describe('the note', () => {
  it('Send clears the panel at once; the outbox goes from sending to sent, and the toast names the ticket', async () => {
    await renderHost();
    await act(async () => openBlankNote());
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'The feed is blank');
    controls.setLatency(100);
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(useReport.getState().outbox.map((o) => o.status)).toEqual(['sending']);
    expect(useReport.getState().draft).toBeNull();
    expect(screen.getByTestId('report-drop-sending')).toBeTruthy();
    expect(await screen.findByText(/^Filed BEV-\d+$/)).toBeTruthy();
    expect(useReport.getState().outbox.map((o) => o.status)).toEqual(['sent']);
    expect(useReport.getState().unplaced).toHaveLength(1);
  });

  it('a failed send keeps the note; pressing the drop restores it and Try again uses the same key', async () => {
    const report = jest.spyOn(api.bugs, 'report');
    await renderHost();
    await act(async () => openBlankNote());
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Ratings vanish after a refresh');
    controls.failNext('network', 'bugs.report');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useReport.getState().outbox[0]?.status).toBe('failed'));
    expect(screen.getByTestId('report-drop-failed')).toBeTruthy();

    await pressDrop();
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Ratings vanish after a refresh');
    expect(screen.getByText("You're offline. Your note is kept.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Filed BEV-\d+$/);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]![0].idempotencyKey).toBe(report.mock.calls[0]![0].idempotencyKey);
  });

  it('set aside keeps the note; pressing the drop reopens it', async () => {
    await renderHost();
    await act(async () => openBlankNote());
    await fireEvent.changeText(screen.getByLabelText("What's going on?"), 'Half typed');
    await fireEvent.press(screen.getByLabelText('Set aside'));
    expect(screen.queryByTestId('report-note')).toBeNull();
    expect(screen.getByTestId('report-drop-aside')).toBeTruthy();
    expect(drop().props.accessibilityValue).toEqual({ text: 'Note set aside' });
    await pressDrop();
    expect(screen.getByLabelText("What's going on?").props.value).toBe('Half typed');
    expect(captureScreen).not.toHaveBeenCalled();
  });

  it('discard asks first', async () => {
    await renderHost();
    await act(async () => openBlankNote());
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

  it('the kind chip shows the inferred kind and pins the next one on press', async () => {
    await renderHost();
    await act(async () => void markLevels([level('TabBar › Add Bev')]));
    expect(screen.getByLabelText('Type: Design nit. Press to change.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Type: Design nit. Press to change.'));
    expect(screen.getByLabelText('Type: Bug. Press to change.')).toBeTruthy();
    expect(useReport.getState().draft?.kindOverride).toBe('bug');
    expect(screen.getByLabelText('What about it?')).toBeTruthy();
    expect(screen.getByLabelText('Mark 1, TabBar › Add Bev')).toBeTruthy();
  });

  it('the attached line says what goes with the note and expands to the full list', async () => {
    await renderHost();
    await act(async () => void markLevels([level('TabBar › Add Bev')]));
    const line = await screen.findByLabelText(/^Sent with it: 1 picture · 2 recorded steps/);
    expect(screen.queryByText('Include recorded steps')).toBeNull();
    await fireEvent.press(line);
    expect(screen.getByText('Include recorded steps')).toBeTruthy();
    expect(screen.getByText('1. Open /feed')).toBeTruthy();
    expect(screen.getByText('Only what you see here is sent. Nothing you typed elsewhere.')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Include recorded steps'), 'valueChange', false);
    expect(useReport.getState().draft?.includeSteps).toBe(false);
  });
});
