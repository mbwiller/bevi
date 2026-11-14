import type { PreparedPhoto } from '@/features/create-bev/photo';

import { captureScreen, releaseShot } from '../capture';
import { loadDraft, saveDraft, type StorageLike } from '../draft';
import { pictureNotices } from '../model';
import {
  addPhotos,
  captureWholeScreen,
  discardNote,
  hydrate,
  markLevels,
  navigate,
  removeMark,
  removePhoto,
  resetReport,
  setReportStorage,
  setText,
  settleCaptures,
  stepLevel,
  useReport,
} from '../store';
import type { PickLevel, Shot } from '../types';

// The engine is another task's; here it is what its contract says it returns.
jest.mock('../capture', () => ({ captureScreen: jest.fn(), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []), pickScreen: jest.fn(() => null) }));
jest.mock('../trail', () => ({
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/'),
  trailSnapshot: jest.fn(() => []),
  recordedSteps: jest.fn(() => []),
  hadRecentFailure: jest.fn(() => false),
}));
jest.mock('../infer', () => ({ inferKind: jest.fn(() => 'bug'), titleFor: jest.fn((note: string) => note) }));

const mockCapture = captureScreen as jest.MockedFunction<typeof captureScreen>;
const mockRelease = releaseShot as jest.MockedFunction<typeof releaseShot>;

function level(name: string, y = 100): PickLevel {
  return { target: { component: name }, box: { x: 10, y, width: 100, height: 40 }, title: name };
}

let shotCount = 0;
function shot(): Shot {
  shotCount += 1;
  return { blob: new Blob(['jpeg']), mimeType: 'image/jpeg', uri: `blob:shot-${shotCount}`, width: 390, height: 844 };
}

function photo(n: number): PreparedPhoto {
  return { uri: `blob:photo-${n}`, blob: new Blob(['p']), mimeType: 'image/jpeg', width: 10, height: 10 };
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

  it('a whole-screen capture is a note with one picture and no marks', async () => {
    captureWholeScreen();
    await settle();
    expect(mockCapture).toHaveBeenCalledWith([]);
    expect(draft().marks).toEqual([]);
    expect(draft().shots).toHaveLength(1);
    expect(useReport.getState()).toMatchObject({ panel: 'open', focusNote: true });
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
      idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11',
    });
    setReportStorage(store);
    hydrate();
    expect(draft()).toMatchObject({ text: 'Too heavy', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11', restored: true });
    expect(draft().marks[0]).toMatchObject({ n: 1, route: '/feed', noPicture: 'restored' });
    expect(pictureNotices(draft())).toEqual(["Screenshots weren't kept. Mark it again to add one."]);
    expect(useReport.getState().panel).toBe('closed');
  });

  it('keeps the tickets to place under their own key', () => {
    const store = memory();
    store.setItem('bevi.bug-report.unplaced', JSON.stringify(['BEV-4']));
    setReportStorage(store);
    hydrate();
    expect(useReport.getState().unplaced).toEqual(['BEV-4']);
  });
});
