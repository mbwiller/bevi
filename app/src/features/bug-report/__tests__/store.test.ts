import type { PreparedPhoto } from '@/features/create-bev/photo';
import { useSession } from '@/state/session';

import { captureScreen, releaseShot } from '../capture';
import { loadDraft, loadUnplaced, saveDraft, saveUnplaced, type StorageLike } from '../draft';
import { startPickMode, type PickModeHandlers } from '../pickMode';
import { startStepRecording, stopStepRecording } from '../trail';
import { pictureNotices } from '../model';
import {
  addPhotos,
  addUnplaced,
  cancelSelecting,
  captureWholeScreen,
  discardNote,
  hydrate,
  markLevels,
  navigate,
  pressReportButton,
  removeShot,
  removeSteps,
  sendNote,
  removeMark,
  removePhoto,
  resetReport,
  setReportStorage,
  setText,
  settleCaptures,
  startRecording,
  startSelecting,
  stepLevel,
  stopRecording,
  useReport,
} from '../store';
import type { PickLevel, Shot } from '../types';

// The engine is another task's; here it is what its contract says it returns.
jest.mock('../capture', () => ({ captureScreen: jest.fn(), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []) }));
jest.mock('../pickMode', () => ({ startPickMode: jest.fn(() => () => {}), isPickModeOn: jest.fn(() => false) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/'),
  trailSnapshot: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
  startStepRecording: jest.fn(),
  stopStepRecording: jest.fn(() => []),
}));
jest.mock('../infer', () => ({ inferKind: jest.fn(() => 'bug'), titleFor: jest.fn((note: string) => note) }));

const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;
const mockRelease = releaseShot as jest.MockedFunction<typeof releaseShot>;
const mockPickMode = startPickMode as jest.MockedFunction<typeof startPickMode>;
const mockStartRec = startStepRecording as jest.MockedFunction<typeof startStepRecording>;
const mockStopRec = stopStepRecording as jest.MockedFunction<typeof stopStepRecording>;

function level(name: string, y = 100): PickLevel {
  return { target: { component: name }, box: { x: 10, y, width: 100, height: 40 }, title: name };
}

let shotCount = 0;
function shot(): Shot {
  shotCount += 1;
  return { blob: new Blob(['jpeg']), mimeType: 'image/jpeg', uri: `blob:shot-${shotCount}`, width: 390, height: 844 };
}

function photo(n: number): PreparedPhoto {
  return { uri: `blob:photo-${n}`, file: new Blob(['p']), mimeType: 'image/jpeg', width: 10, height: 10 };
}

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const draft = () => useReport.getState().draft!;
const settle = () => settleCaptures(draft().idempotencyKey);

beforeEach(() => {
  resetReport();
  setReportStorage(memory());
  shotCount = 0;
  mockCapture.mockReset();
  mockCapture.mockImplementation(async () => shot());
  mockRelease.mockReset();
  navigate('/feed', '/feed');
});

describe('marking', () => {
  it('numbers marks within a visit, and starts again on the next screen', async () => {
    markLevels([level('A')]);
    markLevels([level('B')]);
    navigate('/lists', '/lists');
    markLevels([level('C')]);
    await settle();
    expect(draft().marks.map((m) => [m.route, m.n])).toEqual([
      ['/feed', 1],
      ['/feed', 2],
      ['/lists', 1],
    ]);
    expect(useReport.getState().panel).toBe('open');
  });

  it('keeps one picture per visit: a second mark retakes it with both outlines and lets the first go', async () => {
    markLevels([level('A', 100)]);
    await settle();
    const first = draft().shots[0]!.shot!;
    markLevels([level('B', 300)]);
    await settle();
    expect(draft().shots).toHaveLength(1);
    expect(draft().shots[0]!.shot!.uri).not.toBe(first.uri);
    expect(mockCapture).toHaveBeenLastCalledWith([
      { box: level('A', 100).box, n: 1 },
      { box: level('B', 300).box, n: 2 },
    ]);
    expect(mockRelease).toHaveBeenCalledWith(first);
  });

  it('opens the note as soon as the mark exists, before the picture lands', async () => {
    let land: (s: Shot | null) => void = () => {};
    mockCapture.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
    markLevels([level('A')]);
    expect(useReport.getState().panel).toBe('open');
    expect(draft().shots[0]).toMatchObject({ shot: null, pending: true });
    land(shot());
    await settle();
    expect(draft().shots[0]).toMatchObject({ pending: false, shot: { uri: 'blob:shot-1' } });
  });

  it('throws away a picture that lands after a newer one was asked for', async () => {
    const lands: ((s: Shot | null) => void)[] = [];
    mockCapture.mockImplementation(() => new Promise((resolve) => lands.push(resolve)));
    markLevels([level('A')]);
    markLevels([level('B')]);
    const late = shot();
    const fresh = shot();
    lands[1]!(fresh);
    lands[0]!(late);
    await settle();
    expect(draft().shots[0]!.shot).toBe(fresh);
    expect(mockRelease).toHaveBeenCalledWith(late);
  });

  it('a capture that fails keeps the mark, without a picture, and says so', async () => {
    mockCapture.mockResolvedValueOnce(null);
    markLevels([level('A')]);
    await settle();
    expect(draft().shots).toHaveLength(0);
    expect(draft().marks[0]).toMatchObject({ noPicture: 'failed' });
    expect(pictureNotices(draft())).toContain("Couldn't take a picture of this screen. The component details are still attached.");
  });

  it('Capture screen adds a new unmarked picture on every press, beside a marked one, until three', async () => {
    captureWholeScreen();
    await settle();
    expect(mockCapture).toHaveBeenCalledWith([]);
    expect(draft().marks).toEqual([]);
    captureWholeScreen();
    await settle();
    expect(draft().shots.map((x) => [x.kind, x.route])).toEqual([
      ['screen', '/feed'],
      ['screen', '/feed'],
    ]);
    navigate('/lists', '/lists');
    markLevels([level('A')]);
    await settle();
    expect(draft().shots.map((x) => x.kind)).toEqual(['screen', 'screen', 'marked']);
    mockCapture.mockClear();
    captureWholeScreen();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(draft().shots).toHaveLength(3);
    // A second mark on the marked screen still redraws its one marked picture.
    markLevels([level('B')]);
    await settle();
    expect(mockCapture).toHaveBeenCalledWith([
      { box: level('A').box, n: 1 },
      { box: level('B').box, n: 2 },
    ]);
    expect(draft().shots).toHaveLength(3);
  });

  it('a screen picture that cannot be taken leaves nothing behind and says so', async () => {
    mockCapture.mockResolvedValueOnce(null);
    captureWholeScreen();
    expect(draft().shots).toMatchObject([{ kind: 'screen', pending: true, shot: null }]);
    await settle();
    expect(draft().shots).toEqual([]);
    expect(pictureNotices(draft())).toEqual(["Couldn't take a picture of this screen."]);
  });

  it('Wider and Narrower step through the levels and retake the picture', async () => {
    markLevels([level('Inner', 100), level('Outer', 50)]);
    await settle();
    const id = draft().marks[0]!.id;
    stepLevel(id, -1);
    expect(draft().marks[0]!.levelIndex).toBe(0);
    stepLevel(id, 1);
    await settle();
    expect(draft().marks[0]!.levelIndex).toBe(1);
    expect(mockCapture).toHaveBeenLastCalledWith([{ box: level('Outer', 50).box, n: 1 }]);
    stepLevel(id, 1);
    expect(draft().marks[0]!.levelIndex).toBe(1);
  });

  it('removing a mark renumbers the rest of its screen and retakes the picture; the last one takes the picture with it', async () => {
    markLevels([level('A')]);
    markLevels([level('B')]);
    await settle();
    removeMark(draft().marks[0]!.id);
    await settle();
    expect(draft().marks.map((m) => [m.levels[0]!.title, m.n])).toEqual([['B', 1]]);
    expect(mockCapture).toHaveBeenLastCalledWith([{ box: level('B').box, n: 1 }]);
    removeMark(draft().marks[0]!.id);
    expect(draft().shots).toHaveLength(0);
  });
});

describe('the three-picture limit', () => {
  it('a mark on a fourth screen is kept with its details and takes no picture', async () => {
    for (const route of ['/a', '/b', '/c', '/d']) {
      navigate(route, route);
      markLevels([level(route)]);
      await settle();
    }
    expect(mockCapture).toHaveBeenCalledTimes(3);
    expect(draft().shots).toHaveLength(3);
    expect(draft().marks).toHaveLength(4);
    expect(draft().marks[3]).toMatchObject({ route: '/d', noPicture: 'limit' });
    expect(pictureNotices(draft())).toContain('3 pictures is the limit; this mark has no picture.');
  });

  it('counts photos too: two photos leave room for one capture', async () => {
    captureWholeScreen();
    await settle();
    expect(addPhotos([photo(1), photo(2), photo(3)]).map((p) => p.uri)).toEqual(['blob:photo-3']);
    navigate('/lists', '/lists');
    markLevels([level('A')]);
    await settle();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(draft().marks[0]).toMatchObject({ noPicture: 'limit' });
    removePhoto('blob:photo-2');
    expect(draft().photos.map((p) => p.uri)).toEqual(['blob:photo-1']);
  });

  it('a second mark on a screen that already has its picture still retakes it at the limit', async () => {
    for (const route of ['/a', '/b', '/c']) {
      navigate(route, route);
      markLevels([level(route)]);
      await settle();
    }
    markLevels([level('again')]);
    await settle();
    expect(mockCapture).toHaveBeenCalledTimes(4);
    expect(draft().shots).toHaveLength(3);
  });
});

describe('persistence', () => {
  it('saves the text and the marks as they change, never the pictures, and forgets a discarded note', async () => {
    const store = memory();
    setReportStorage(store);
    hydrate('tester');
    markLevels([level('A')]);
    setText('Too heavy');
    await settle();
    expect(loadDraft(store)).toMatchObject({ text: 'Too heavy', marks: [{ n: 1, title: 'A', route: '/feed', target: { component: 'A' } }] });
    expect(store.map.get('bevi.bug-report.draft')).not.toContain('blob:');
    discardNote();
    expect(loadDraft(store)).toBeNull();
  });

  it('restores a saved note with its marks and says the screenshots were not kept', () => {
    const store = memory();
    saveDraft(store, {
      text: 'Too heavy',
      marks: [{ n: 1, title: 'A', target: { component: 'A' }, route: '/feed' }],
      owner: 'tester',
      idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11',
    });
    setReportStorage(store);
    hydrate('tester');
    expect(draft()).toMatchObject({ text: 'Too heavy', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11', restored: true });
    expect(draft().marks[0]).toMatchObject({ n: 1, route: '/feed', noPicture: 'restored' });
    expect(pictureNotices(draft())).toEqual(["Screenshots weren't kept. Mark it again to add one."]);
    expect(useReport.getState().panel).toBe('closed');
  });

  it('keeps the tickets to place under their own key', () => {
    const store = memory();
    saveUnplaced(store, ['BEV-4'], 'tester');
    setReportStorage(store);
    hydrate('tester');
    expect(useReport.getState().unplaced).toEqual(['BEV-4']);
  });

  it('writes nothing before it knows whose this is', async () => {
    const store = memory();
    setReportStorage(store);
    pressReportButton();
    setText('Typed before hydrate');
    addUnplaced('BEV-5');
    await settle();
    expect(store.map.size).toBe(0);
    // State from before `hydrate` belongs to nobody known, so it is not adopted either.
    hydrate('tester');
    expect(useReport.getState().draft).toBeNull();
    pressReportButton();
    setText('Typed after');
    expect(loadDraft(store)).toMatchObject({ text: 'Typed after', owner: 'tester' });
  });

  it('clears an ownerless (legacy) draft and a bare unplaced list instead of showing them to anyone', () => {
    const store = memory();
    // As the old form saved it: no owner, no text.
    store.setItem(
      'bevi.bug-report.draft',
      JSON.stringify({ title: 'Ratings vanish', description: '', steps: '', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11', savedAt: new Date().toISOString() }),
    );
    store.setItem('bevi.bug-report.unplaced', JSON.stringify(['BEV-4']));
    setReportStorage(store);
    hydrate('tester-b');
    expect(useReport.getState()).toMatchObject({ draft: null, unplaced: [] });
    expect(store.map.has('bevi.bug-report.draft')).toBe(false);
    expect(store.map.has('bevi.bug-report.unplaced')).toBe(false);
  });

  it('clears an ownerless draft saved by this build, too', () => {
    const store = memory();
    saveDraft(store, { text: 'No owner', marks: [], idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11' });
    setReportStorage(store);
    hydrate('tester-b');
    expect(useReport.getState().draft).toBeNull();
    expect(loadDraft(store)).toBeNull();
  });
});

describe('pictures removed, and the limit', () => {
  it('marks of a removed marked picture say so, and are not retaken on their own', async () => {
    markLevels([level('A')]);
    markLevels([level('B')]);
    await settle();
    mockCapture.mockClear();
    removeShot(draft().shots[0]!.id);
    expect(draft().shots).toEqual([]);
    expect(draft().marks.map((m) => m.noPicture)).toEqual(['removed', 'removed']);
    expect(pictureNotices(draft())).toEqual(['This mark has no picture. Select it again to add one.']);
    expect(mockCapture).not.toHaveBeenCalled();
    // Selecting again on that screen takes the picture with every mark.
    markLevels([level('C')]);
    await settle();
    expect(draft().marks.map((m) => m.noPicture)).toEqual([undefined, undefined, undefined]);
    expect(pictureNotices(draft())).toEqual([]);
  });

  it('says "3 pictures is the limit" only while there are three; after one is removed, the true line', async () => {
    for (let i = 0; i < 3; i++) {
      captureWholeScreen();
      await settle();
    }
    navigate('/lists', '/lists');
    markLevels([level('A')]);
    await settle();
    expect(pictureNotices(draft())).toEqual(['3 pictures is the limit; this mark has no picture.']);
    removeShot(draft().shots[0]!.id);
    expect(draft().marks[0]!.noPicture).toBe('limit');
    expect(pictureNotices(draft())).toEqual(['This mark has no picture. Select it again to add one.']);
  });
});

describe('a send that lands after the account changed', () => {
  afterEach(() => useSession.setState({ status: 'signedOut', profile: undefined }));

  async function signOutWhileSending(outcome: 'resolve' | 'reject') {
    const store = memory();
    setReportStorage(store);
    useSession.setState({ status: 'ready', profile: { handle: 'tester-a', displayName: 'A', avatarUrl: null } });
    hydrate('tester-a');
    markLevels([level('A')]);
    setText('Sent by A');
    await settle();
    const shotA = draft().shots[0]!.shot!;
    let finish: (ok: boolean) => void = () => {};
    const sender = () =>
      new Promise<{ ticketId: string; ticketUrl: string; status: 'created' }>((resolve, reject) => {
        finish = (ok) => (ok ? resolve({ ticketId: 'BEV-77', ticketUrl: 'https://x/BEV-77', status: 'created' }) : reject(new Error('offline')));
      });
    const sending = sendNote(sender);
    await Promise.resolve();
    await Promise.resolve();
    useSession.setState({ status: 'signedOut', profile: undefined });
    useSession.setState({ status: 'ready', profile: { handle: 'tester-b', displayName: 'B', avatarUrl: null } });
    hydrate('tester-b');
    finish(outcome === 'resolve');
    await sending;
    expect(useReport.getState()).toMatchObject({ unplaced: [], toast: null, outbox: [], draft: null, owner: 'tester-b' });
    expect(mockRelease).toHaveBeenCalledWith(shotA);
    expect(loadUnplaced(store)).toEqual({ ids: [] });
  }

  it('leaves B no ticket to place, no toast and no outbox row when it was filed', () => signOutWhileSending('resolve'));
  it('and nothing either when it failed', () => signOutWhileSending('reject'));
});

describe('the floating button', () => {
  it('opens an empty note without capturing, then sets it aside, then opens it again', () => {
    pressReportButton();
    expect(useReport.getState()).toMatchObject({ panel: 'open', focusNote: true });
    expect(draft().shots).toEqual([]);
    pressReportButton();
    expect(useReport.getState().panel).toBe('closed');
    pressReportButton();
    expect(useReport.getState().panel).toBe('open');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('select mode', () => {
  it('steps the note aside, highlights on hover, and a pick marks, captures and reopens the note', async () => {
    const stop = jest.fn();
    let handlers: PickModeHandlers | undefined;
    mockPickMode.mockImplementationOnce((h) => {
      handlers = h;
      return stop;
    });
    pressReportButton();
    startSelecting();
    expect(useReport.getState()).toMatchObject({ selecting: true, panel: 'closed' });
    handlers!.onHover([level('Hovered')]);
    expect(useReport.getState().picking?.levels[0]?.title).toBe('Hovered');
    handlers!.onPick([level('Picked')]);
    expect(stop).toHaveBeenCalled();
    expect(useReport.getState()).toMatchObject({ selecting: false, panel: 'open', picking: null });
    expect(draft().marks[0]).toMatchObject({ n: 1, levels: [{ title: 'Picked' }] });
    expect(useReport.getState().selectedMarkId).toBe(draft().marks[0]!.id);
    await settle();
    expect(mockCapture).toHaveBeenCalledWith([{ box: level('Picked').box, n: 1 }]);
  });

  it('Cancel, Escape and a navigation end it with the note back as it was', () => {
    const stop = jest.fn();
    let handlers: PickModeHandlers | undefined;
    mockPickMode.mockImplementation((h) => {
      handlers = h;
      return stop;
    });
    pressReportButton();
    startSelecting();
    cancelSelecting();
    expect(useReport.getState()).toMatchObject({ selecting: false, panel: 'open' });
    startSelecting();
    handlers!.onCancel();
    expect(useReport.getState()).toMatchObject({ selecting: false, panel: 'open' });
    startSelecting();
    navigate('/lists', '/lists');
    expect(useReport.getState()).toMatchObject({ selecting: false, panel: 'open' });
    expect(stop).toHaveBeenCalledTimes(3);
    expect(draft().marks).toEqual([]);
    mockPickMode.mockReset();
    mockPickMode.mockImplementation(() => () => {});
  });

  it('says so, with the note back, when select mode cannot start', () => {
    mockPickMode.mockImplementationOnce(() => {
      throw new Error('not implemented');
    });
    pressReportButton();
    startSelecting();
    expect(useReport.getState()).toMatchObject({ selecting: false, panel: 'open', notice: "Selecting isn't available here." });
  });
});

describe('recording steps', () => {
  it('records only between Record steps and Stop, and the steps go into the note', () => {
    let onStep: ((steps: string[]) => void) | undefined;
    mockStartRec.mockImplementationOnce((_route, cb) => {
      onStep = cb;
      cb?.(['Start on /feed']);
    });
    pressReportButton();
    startRecording();
    expect(mockStartRec).toHaveBeenCalledWith('/feed', expect.any(Function));
    expect(useReport.getState()).toMatchObject({ panel: 'closed', recording: { steps: ['Start on /feed'] } });
    onStep!(['Start on /feed', 'Open /lists']);
    expect(useReport.getState().recording?.steps).toHaveLength(2);
    mockStopRec.mockReturnValueOnce(['Start on /feed', 'Open /lists']);
    // While recording, the floating button is Stop.
    pressReportButton();
    expect(useReport.getState()).toMatchObject({ recording: null, panel: 'open' });
    expect(draft().steps).toEqual(['Start on /feed', 'Open /lists']);
    removeSteps();
    expect(draft().steps).toEqual([]);
  });

  it('stopRecording without a recording does nothing; a recording that cannot start says so', () => {
    stopRecording();
    expect(useReport.getState().draft).toBeNull();
    mockStartRec.mockImplementationOnce(() => {
      throw new Error('not implemented');
    });
    pressReportButton();
    startRecording();
    expect(useReport.getState()).toMatchObject({ recording: null, panel: 'open', notice: "Recording isn't available here." });
  });
});

describe('one account at a time', () => {
  afterEach(() => useSession.setState({ status: 'signedOut', profile: undefined }));

  it("signing out wipes tester A's note and tickets to place, in memory and in storage", async () => {
    const store = memory();
    setReportStorage(store);
    useSession.setState({ status: 'ready', profile: { handle: 'tester-a', displayName: 'A', avatarUrl: null } });
    hydrate('tester-a');
    markLevels([level('A')]);
    setText('Note by A');
    addUnplaced('BEV-7');
    await settle();
    const shotA = draft().shots[0]!.shot!;
    expect(loadDraft(store)).toMatchObject({ text: 'Note by A', owner: 'tester-a' });
    expect(loadUnplaced(store)).toEqual({ ids: ['BEV-7'], owner: 'tester-a' });

    useSession.setState({ status: 'signedOut', profile: undefined });
    expect(useReport.getState()).toMatchObject({ draft: null, unplaced: [], outbox: [] });
    expect(mockRelease).toHaveBeenCalledWith(shotA);
    expect(loadDraft(store)).toBeNull();
    expect(loadUnplaced(store)).toEqual({ ids: [] });

    useSession.setState({ status: 'ready', profile: { handle: 'tester-b', displayName: 'B', avatarUrl: null } });
    hydrate('tester-b');
    expect(useReport.getState()).toMatchObject({ draft: null, unplaced: [] });
  });

  it("never restores another handle's stored note or tickets, and forgets them", () => {
    const store = memory();
    saveDraft(store, { text: 'Note by A', marks: [], owner: 'tester-a', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11' });
    saveUnplaced(store, ['BEV-7'], 'tester-a');
    setReportStorage(store);
    hydrate('tester-b');
    expect(useReport.getState()).toMatchObject({ draft: null, unplaced: [] });
    expect(loadDraft(store)).toBeNull();
    expect(loadUnplaced(store)).toEqual({ ids: [] });
  });

  it('wipes what is in memory when the host mounts for a different handle', () => {
    hydrate('tester-a');
    pressReportButton();
    setText('Note by A');
    hydrate('tester-b');
    expect(useReport.getState().draft).toBeNull();
    expect(useReport.getState().owner).toBe('tester-b');
  });
});
