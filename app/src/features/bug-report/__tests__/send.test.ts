import type { BugBreadcrumb } from '@bevi/shared';

import { inferKind, titleFor } from '../infer';
import { emptyDraft, type Draft } from '../model';
import { buildInput } from '../send';
import { hadRecentFailure } from '../trail';
import type { PickLevel, Shot } from '../types';

// The engine's pure functions, standing in for the engine task's, so this suite pins how the
// input is assembled rather than how a title is worded.
jest.mock('../infer', () => ({
  inferKind: jest.fn((_note: string, s: { hasTarget: boolean; recentFailure: boolean }) =>
    s.recentFailure ? 'bug' : s.hasTarget ? 'design' : 'bug',
  ),
  titleFor: jest.fn((note: string, pointedAt?: string) => (pointedAt ? `${pointedAt}: ${note}` : note)),
}));
jest.mock('../trail', () => ({
  hadRecentFailure: jest.fn(() => false),
  trailSnapshot: jest.fn(() => []),
  startTrail: jest.fn(() => () => {}),
  recordNav: jest.fn(),
  routePattern: jest.fn(() => '/'),
}));
jest.mock('../capture', () => ({ captureScreen: jest.fn(), releaseShot: jest.fn() }));
jest.mock('../pick', () => ({ pickAt: jest.fn(() => []) }));

const KEY = '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11';
const ENV = { route: '/feed', occurredAt: '2026-11-13T10:00:00.000Z', platform: 'web / Safari' };
const TRAIL: BugBreadcrumb[] = [
  { at: '2026-11-13T09:59:00.000Z', kind: 'nav', route: '/feed' },
  { at: '2026-11-13T09:59:30.000Z', kind: 'tap', target: 'TabBar › Add Bev' },
];

function level(component: string, title: string): PickLevel {
  return { target: { component, label: title }, box: { x: 0, y: 0, width: 10, height: 10 }, title };
}

function shot(uri: string): Shot {
  return { blob: new Blob([uri]), mimeType: 'image/jpeg', uri, width: 390, height: 844 };
}

function twoScreens(): Draft {
  const d = emptyDraft(KEY, ENV);
  d.text = 'too heavy, make it flat';
  d.marks = [
    { id: 'm1', n: 1, levels: [level('TabBar', 'TabBar › Add Bev'), level('Tabs', 'Tabs')], levelIndex: 0, route: '/feed', visit: 1, shotId: 's1' },
    { id: 'm2', n: 2, levels: [level('BevRow', 'BevRow · Coca-Cola')], levelIndex: 0, route: '/feed', visit: 1, shotId: 's1' },
    { id: 'm3', n: 1, levels: [level('Header', 'Header'), level('ListsScreen', 'ListsScreen')], levelIndex: 1, route: '/lists', visit: 2, shotId: 's2' },
  ];
  d.shots = [
    { id: 's1', kind: 'marked', shot: shot('blob:feed'), route: '/feed', visit: 1, seq: 1, pending: false },
    { id: 's2', kind: 'marked', shot: shot('blob:lists'), route: '/lists', visit: 2, seq: 2, pending: false },
  ];
  d.photos = [{ uri: 'blob:photo', file: new Blob(['p']), mimeType: 'image/jpeg', width: 1, height: 1 }];
  d.steps = ['Start on /feed', 'Tap TabBar › Add Bev', 'Open /lists'];
  return d;
}

beforeEach(() => {
  (hadRecentFailure as jest.Mock).mockReturnValue(false);
});

describe('buildInput', () => {
  it('files a note with marks on two screens: targets, pictures and their captions, steps', () => {
    const input = buildInput(twoScreens(), TRAIL);
    expect(input).toMatchObject({
      kind: 'design',
      severity: 'annoying',
      title: 'TabBar › Add Bev: too heavy, make it flat',
      description: 'too heavy, make it flat',
      reproductionSteps: ['Start on /feed', 'Tap TabBar › Add Bev', 'Open /lists'],
      stepsSource: 'recorded',
      breadcrumbs: TRAIL,
      environment: ENV,
      idempotencyKey: KEY,
    });
    expect(input.targets).toEqual([
      { component: 'TabBar', label: 'TabBar › Add Bev', route: '/feed', mark: 1, evidenceIndex: 0 },
      { component: 'BevRow', label: 'BevRow · Coca-Cola', route: '/feed', mark: 2, evidenceIndex: 0 },
      // Its chosen level is the wider one.
      { component: 'ListsScreen', label: 'ListsScreen', route: '/lists', mark: 1, evidenceIndex: 1 },
    ]);
    expect(input.evidence?.map((e) => e.caption)).toEqual(['/feed, with 1 and 2 marked', '/lists, with 1 marked', 'Photo from the library']);
    expect(input.evidence?.every((e) => e.mimeType === 'image/jpeg')).toBe(true);
    expect(titleFor).toHaveBeenCalledWith('too heavy, make it flat', 'TabBar › Add Bev');
  });

  it('never sends more than 3 pictures: captures first, then photos', () => {
    const d = twoScreens();
    d.photos = [...d.photos, { uri: 'blob:photo-2', file: new Blob(['q']), mimeType: 'image/jpeg', width: 1, height: 1 }];
    const input = buildInput(d, TRAIL);
    expect(input.evidence).toHaveLength(3);
    expect(input.evidence?.[2]?.caption).toBe('Photo from the library');
  });

  it('evidence is only ever a Blob: a photo prepared as bytes (native) is left out', () => {
    const d = twoScreens();
    d.photos = [{ uri: 'file:///photo.jpg', file: new Uint8Array([0xff, 0xd8]), mimeType: 'image/jpeg', width: 1, height: 1 }];
    const input = buildInput(d, TRAIL);
    expect(input.evidence).toHaveLength(2);
    expect(input.evidence?.every((e) => e.file instanceof Blob)).toBe(true);
  });

  it('a mark without a picture has no evidenceIndex', () => {
    const d = twoScreens();
    d.shots = d.shots.slice(0, 1);
    const input = buildInput(d, TRAIL);
    expect(input.targets?.[2]).toEqual({ component: 'ListsScreen', label: 'ListsScreen', route: '/lists', mark: 1 });
  });

  it('uses the inferred kind until one is pinned, and the pinned one after', () => {
    const d = twoScreens();
    (hadRecentFailure as jest.Mock).mockReturnValue(true);
    expect(buildInput(d, TRAIL).kind).toBe('bug');
    expect(inferKind).toHaveBeenLastCalledWith('too heavy, make it flat', { hasTarget: true, recentFailure: true });
    d.kindOverride = 'idea';
    expect(buildInput(d, TRAIL).kind).toBe('idea');
  });

  it('a whole-screen note has no targets, a "whole screen" caption and an unprefixed title', () => {
    const d = emptyDraft(KEY, ENV);
    d.text = 'The feed is blank';
    d.shots = [{ id: 's1', kind: 'screen', shot: shot('blob:feed'), route: '/feed', visit: 1, seq: 0, pending: false }];
    const input = buildInput(d, TRAIL);
    expect(input.targets).toBeUndefined();
    expect(input.title).toBe('The feed is blank');
    expect(input.kind).toBe('bug');
    expect(input.evidence?.map((e) => e.caption)).toEqual(['/feed, whole screen']);
  });

  it('sends no steps, and no stepsSource, when none were recorded; the trail still goes as breadcrumbs', () => {
    const d = twoScreens();
    d.steps = [];
    const input = buildInput(d, TRAIL);
    expect(input.reproductionSteps).toBeUndefined();
    expect(input.stepsSource).toBeUndefined();
    expect(input.breadcrumbs).toEqual(TRAIL);
  });

  it('still files when the engine throws: a plain title and the no-signal kind', () => {
    (titleFor as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not implemented');
    });
    (inferKind as jest.Mock).mockImplementationOnce(() => {
      throw new Error('not implemented');
    });
    const input = buildInput(twoScreens(), TRAIL);
    expect(input.title).toBe('TabBar › Add Bev: too heavy, make it flat');
    expect(input.kind).toBe('design');
  });

  it('keeps two whole-screen pictures of one screen, numbered, and points a mark at its marked picture wherever it sits', () => {
    const d = emptyDraft(KEY, ENV);
    d.text = 'The list jumps';
    d.marks = [{ id: 'm1', n: 1, levels: [level('BevRow', 'BevRow · Coca-Cola')], levelIndex: 0, route: '/lists', visit: 3, shotId: 'm' }];
    d.shots = [
      { id: 'a', kind: 'screen', shot: shot('blob:a'), route: '/lists', visit: 3, seq: 0, pending: false },
      { id: 'b', kind: 'screen', shot: shot('blob:b'), route: '/lists', visit: 3, seq: 0, pending: false },
      { id: 'm', kind: 'marked', shot: shot('blob:m'), route: '/lists', visit: 3, seq: 1, pending: false },
    ];
    const input = buildInput(d, TRAIL);
    expect(input.evidence?.map((e) => e.caption)).toEqual(['/lists, whole screen', '/lists, whole screen (2)', '/lists, with 1 marked']);
    expect(input.targets?.[0]).toMatchObject({ component: 'BevRow', mark: 1, evidenceIndex: 2 });
  });
});
