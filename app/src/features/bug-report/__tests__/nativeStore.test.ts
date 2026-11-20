import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ApiError, type BugReportInput } from '@bevi/shared';

import { captureScreen, releaseShot } from '../capture';
import { DRAFT_KEY } from '../draft';
import { loadStorage, nativeStorage, resetNativeStorage } from '../draftStorage';
import {
  addUnplaced,
  FULL_SCREEN_SHEET_NOTICE,
  hydrate,
  navigate,
  openBlankNote,
  openRank,
  openReports,
  pressReportButton,
  resetReport,
  sendNote,
  setContextInput,
  setOnFullScreen,
  setReportStorage,
  setText,
  useReport,
} from '../store';
import type { Shot } from '../types';

// The iOS reporter's store behaviour (jest resolves modules as iOS; jest.setup.js's web stand-ins
// for `capabilities` and `supported` are undone): a new note opens only after the screenshot, and
// carries it as bytes; a restored note comes back through AsyncStorage without its picture; the
// sheets stay shut over a full-screen flow.

jest.unmock('../capabilities');
jest.unmock('../supported');

jest.mock('../capture', () => ({ captureScreen: jest.fn(), releaseShot: jest.fn() }));
const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;
const mockRelease = releaseShot as jest.MockedFunction<typeof releaseShot>;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
let shotCount = 0;
function shot(): Shot {
  shotCount += 1;
  return { file: JPEG, mimeType: 'image/jpeg', uri: `file:///tmp/shot-${shotCount}.jpg`, width: 738, height: 1599, tmp: `/tmp/shot-${shotCount}.jpg` };
}

/** A capture the test lands by hand, so "before" and "after" are facts about order. */
function holdCapture(): { land: (s: Shot | null) => void } {
  let land: (s: Shot | null) => void = () => {};
  mockCapture.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
  return { land: (s) => land(s) };
}

const state = () => useReport.getState();

beforeEach(async () => {
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue('18.2');
  resetReport();
  await AsyncStorage.clear();
  resetNativeStorage();
  setReportStorage(nativeStorage);
  setContextInput({ scheme: 'light', insets: { top: 59, right: 0, bottom: 34, left: 0 } });
  shotCount = 0;
  mockCapture.mockReset();
  mockCapture.mockImplementation(async () => shot());
  mockRelease.mockReset();
  navigate('/feed', '/feed');
});

describe('a new note on iOS opens after the screenshot, with it', () => {
  it('takes the picture before the note exists, then opens it with the picture attached', async () => {
    const held = holdCapture();
    openBlankNote();
    // The capture is running; the reporter's own UI is not up: no note, no panel.
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(state().draft).toBeNull();
    expect(state().panel).toBe('closed');

    held.land(shot());
    await waitFor(() => expect(state().panel).toBe('open'));
    expect(state().draft?.shots).toHaveLength(1);
    expect(state().draft?.shots[0]).toMatchObject({ kind: 'screen', route: '/feed', pending: false });
    expect(state().draft?.shots[0]?.shot?.file).toBeInstanceOf(Uint8Array);
    expect(state().focusNote).toBe(true);
  });

  it('is the button and the Settings request alike: both go through the same capture', async () => {
    pressReportButton();
    await waitFor(() => expect(state().panel).toBe('open'));
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('a second press while the picture is being taken is the same press', async () => {
    const held = holdCapture();
    openBlankNote();
    openBlankNote();
    pressReportButton();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    held.land(shot());
    await waitFor(() => expect(state().panel).toBe('open'));
    expect(state().draft?.shots).toHaveLength(1);
  });

  it('writes the environment as it was when it was pressed', async () => {
    const held = holdCapture();
    openBlankNote();
    navigate('/lists', '/lists');
    held.land(shot());
    await waitFor(() => expect(state().panel).toBe('open'));
    expect(state().draft?.environment).toMatchObject({ route: '/feed', path: '/feed', platform: expect.stringContaining('ios'), theme: 'light' });
    expect(state().draft?.shots[0]?.route).toBe('/feed');
  });

  it('when the picture cannot be taken, the note still opens, says so, and can be sent with words only', async () => {
    mockCapture.mockResolvedValueOnce(null);
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    expect(state().draft?.shots).toEqual([]);
    expect(state().draft?.screenFailed).toBe(true);

    setText('the feed does not refresh');
    const sent: BugReportInput[] = [];
    await sendNote(async (input) => {
      sent.push(input);
      return { ticketId: 'T-1', ticketUrl: 'https://board.example/T-1', status: 'created' };
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.evidence).toBeUndefined();
  });

  it('reopening a note that was set aside does not take another picture', async () => {
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    pressReportButton();
    expect(state().panel).toBe('closed');
    pressReportButton();
    expect(state().panel).toBe('open');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('a link that is about to go away opens the note bare, with no picture', async () => {
    openBlankNote({ shot: false });
    expect(state().panel).toBe('open');
    expect(mockCapture).not.toHaveBeenCalled();
    expect(state().draft?.shots).toEqual([]);
  });

  it('a reset while the picture is being taken (sign-out) opens nothing and lets the picture go', async () => {
    const held = holdCapture();
    openBlankNote();
    resetReport();
    const late = shot();
    held.land(late);
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith(late));
    expect(state().draft).toBeNull();
    expect(state().panel).toBe('closed');
  });
});

describe('what a native report carries', () => {
  async function filed(): Promise<BugReportInput> {
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    setText('The photo viewer will not close');
    const sent: BugReportInput[] = [];
    await sendNote(async (input) => {
      sent.push(input);
      return { ticketId: 'T-2', ticketUrl: 'https://board.example/T-2', status: 'created' };
    });
    return sent[0]!;
  }

  it('is the note, the screenshot as bytes, and what the app sends by itself: no element and no steps', async () => {
    const input = await filed();
    expect(input.description).toBe('The photo viewer will not close');
    expect(input.evidence).toHaveLength(1);
    expect(input.evidence![0]!.file).toBeInstanceOf(Uint8Array);
    expect(typeof Blob === 'undefined' || !(input.evidence![0]!.file instanceof Blob)).toBe(true);
    expect(input.evidence![0]).toMatchObject({ mimeType: 'image/jpeg', caption: '/feed, whole screen' });
    // Stage 1: none of these, so none are sent (the contract's and the function's "none").
    expect(input.targets).toBeUndefined();
    expect(input.reproductionSteps).toBeUndefined();
    expect(input.stepsSource).toBeUndefined();
    expect(input.environment).toMatchObject({
      route: '/feed',
      path: '/feed',
      platform: expect.stringMatching(/^ios/),
      osVersion: expect.stringMatching(/^iOS /),
      appVersion: expect.any(String),
      build: expect.stringContaining('contract 3.3.0'),
      stage: expect.any(String),
      occurredAt: expect.any(String),
    });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the screenshot for a retry after a failed send, under the same key', async () => {
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    setText('x');
    const key = state().draft!.idempotencyKey;
    await sendNote(async () => {
      throw new ApiError('network', 'offline');
    });
    const failed = state().outbox[0]!;
    expect(failed.status).toBe('failed');
    expect(failed.draft?.shots[0]?.shot?.file).toBeInstanceOf(Uint8Array);
    expect(failed.key).toBe(key);
    // A failed note is not released: its picture is still there to retry with.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('lets the temporary file go once the report is filed', async () => {
    await filed();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe('the note survives a relaunch through AsyncStorage, without its picture', () => {
  it('persists the text and the type, and nothing of the screenshot', async () => {
    await loadStorage();
    hydrate('tester');
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    setText('the rank screen flickers');
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) ?? '{}').text).toBe('the rank screen flickers'));
    const raw = (await AsyncStorage.getItem(DRAFT_KEY))!;
    expect(raw).not.toMatch(/file:\/\/|shot|\.jpg|tmp|uri/);
    expect(JSON.parse(raw).owner).toBe('tester');
  });

  it('restores the note after a relaunch, says its screenshot was not kept, and files it under the same key', async () => {
    await loadStorage();
    hydrate('tester');
    openBlankNote();
    await waitFor(() => expect(state().panel).toBe('open'));
    setText('the rank screen flickers');
    const key = state().draft!.idempotencyKey;
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toContain('flickers'));
    // Writes are queued behind the one just seen; let the queue drain before "quitting".
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).not.toBeNull());

    // Relaunch: the process memory is gone, AsyncStorage is not.
    resetReport();
    resetNativeStorage();
    expect(state().draft).toBeNull();
    await loadStorage();
    hydrate('tester');
    expect(state().draft).toMatchObject({ text: 'the rank screen flickers', idempotencyKey: key, restored: true, shots: [], photos: [] });
  });

  it("never restores another account's note", async () => {
    await AsyncStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ text: 'not yours', marks: [], owner: 'someone-else', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11', savedAt: new Date().toISOString() }),
    );
    await loadStorage();
    hydrate('tester');
    expect(state().draft).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

describe('the two sheets over a full-screen flow', () => {
  it('stay shut there, and say why in the note', () => {
    setOnFullScreen(true);
    openReports();
    expect(state().sheet).toBeNull();
    expect(state().notice).toBe(FULL_SCREEN_SHEET_NOTICE);
    openRank(['T-1', 'T-2']);
    expect(state().sheet).toBeNull();
  });

  it('open anywhere else', () => {
    setOnFullScreen(false);
    openReports();
    expect(state().sheet).toBe('reports');
    openRank(['T-1']);
    expect(state().sheet).toBe('rank');
  });

  it('keep their tickets to place: nothing is dropped for being shut', () => {
    addUnplaced('T-9');
    setOnFullScreen(true);
    openRank(['T-9']);
    expect(state().unplaced).toEqual(['T-9']);
  });
});
