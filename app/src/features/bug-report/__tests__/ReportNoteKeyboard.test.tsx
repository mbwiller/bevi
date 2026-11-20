import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { controls } from '@/testing/fakeApi';
import { spacing, type } from '@/theme';

import type { StorageLike } from '../draft';
import { extrasRoom, FIELD_MIN_HEIGHT } from '../noteLayout';
import ReportHost from '../ReportHost';
import { addPhotos, openBlankNote, resetReport, setReportStorage } from '../store';

// T-21: the note's text field was squeezed to a line when the iPhone keyboard opened, and never
// grew past five lines. The keyboard is the hook's answer here; the layout rules are noteLayout's.
let mockKeyboard = 0;
jest.mock('@/lib/useKeyboardInset', () => ({ useKeyboardInset: () => mockKeyboard }));
jest.mock('../capture', () => ({ captureScreen: jest.fn(), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []) }));
jest.mock('../pickMode', () => ({ startPickMode: jest.fn(), isPickModeOn: jest.fn(() => false) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/feed'),
  trailSnapshot: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
  startStepRecording: jest.fn(),
  stopStepRecording: jest.fn(() => []),
}));
jest.mock('expo-router', () => ({ useSegments: () => ['(tabs)', 'feed'], usePathname: () => '/feed' }));

const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };
const KEYBOARD = 336;
const LINE = type.bodyLarge.lineHeight;
const WINDOW = Dimensions.get('window').height;

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

let client: QueryClient;

async function openNote() {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: INSETS }}>
      <QueryClientProvider client={client}>
        <ReportHost />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await act(async () => openBlankNote());
}

const panelStyle = () => StyleSheet.flatten(screen.getByTestId('report-note').props.style);
const fieldStyle = () => StyleSheet.flatten(screen.getByLabelText("What's going on?").props.style);

beforeEach(() => {
  mockKeyboard = 0;
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  controls.setInternalReporter(true);
  resetReport();
  setReportStorage(memory());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

describe('the note and the keyboard (T-21)', () => {
  it('with no keyboard: 60% of the screen at most, the home-indicator padding, the sent-with-it line and the button', async () => {
    await openNote();
    expect(panelStyle()).toMatchObject({ bottom: 0, maxHeight: Math.round(WINDOW * 0.6), paddingBottom: INSETS.bottom + spacing.md });
    expect(screen.getByTestId('report-note-attached')).toBeTruthy();
    expect(screen.getByTestId('report-button')).toBeTruthy();
  });

  it('with the keyboard up: all the room above it, and nothing spent on what typing does not need', async () => {
    mockKeyboard = KEYBOARD;
    await openNote();
    // Off the web the window keeps its height, so what can be seen is the window less the keyboard.
    expect(panelStyle()).toMatchObject({ bottom: KEYBOARD, maxHeight: WINDOW - KEYBOARD - INSETS.top, paddingBottom: spacing.md });
    // The old cap, 60% of what the keyboard left, is what left the field a line.
    expect(panelStyle().maxHeight).toBeGreaterThan(Math.round((WINDOW - KEYBOARD) * 0.6));
    expect(screen.queryByTestId('report-note-attached')).toBeNull();
    // The attach row stays: this is a phone held upright, with room for it.
    expect(screen.getByLabelText('Select element')).toBeTruthy();
    // The button would sit on the text; the note's own chevron sets it aside.
    expect(screen.queryByTestId('report-button')).toBeNull();
    expect(screen.getByLabelText('Set aside')).toBeTruthy();
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
  });

  it('the field starts at three lines, grows with its text past five, and is the first thing to give way', async () => {
    await openNote();
    expect(fieldStyle()).toMatchObject({ height: FIELD_MIN_HEIGHT, minHeight: FIELD_MIN_HEIGHT });
    await fireEvent(screen.getByLabelText("What's going on?"), 'contentSizeChange', { nativeEvent: { contentSize: { width: 300, height: LINE * 12 } } });
    expect(fieldStyle().height).toBe(LINE * 12 + (spacing.md + 1) * 2);
    // Squeezed by the note's cap before the scrollers beside it, and never below its three lines.
    expect(fieldStyle().flexShrink).toBeGreaterThan(1);
    expect(fieldStyle().minHeight).toBe(FIELD_MIN_HEIGHT);
  });

  it('with almost no room over the keyboard (a phone on its side): one line at least, no attach row, Send still there', async () => {
    mockKeyboard = WINDOW - INSETS.top - 200;
    await openNote();
    expect(panelStyle().maxHeight).toBe(200);
    expect(fieldStyle().minHeight).toBe(LINE + (spacing.md + 1) * 2);
    expect(screen.queryByLabelText('Select element')).toBeNull();
    expect(screen.getByText('Send')).toBeTruthy();
  });

  it('pictures get a scroller of their own with a cap, and the field is not inside it', async () => {
    mockKeyboard = KEYBOARD;
    await openNote();
    // Nothing attached: no scroller at all above the field.
    expect(screen.queryByTestId('report-note-extras')).toBeNull();

    await act(async () => void addPhotos([{ uri: 'blob:photo-1', file: new Blob(['p']), mimeType: 'image/jpeg', width: 10, height: 10 }]));
    const extras = screen.getByTestId('report-note-extras');
    expect(within(extras).getByLabelText('Photo 1')).toBeTruthy();
    expect(within(extras).queryByLabelText("What's going on?")).toBeNull();
    const room = WINDOW - KEYBOARD - INSETS.top;
    expect(StyleSheet.flatten(extras.props.style).maxHeight).toBe(extrasRoom(room, KEYBOARD));
    expect(screen.getByLabelText("What's going on?")).toBeTruthy();
  });
});
