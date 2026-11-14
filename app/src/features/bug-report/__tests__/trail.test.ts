/** @jest-environment jsdom */
import { ApiError, type BugBreadcrumb } from '@bevi/shared';

import { observed } from '@/api/observe';

import { tapTitle } from '../pick';
import { hadRecentFailure, recordedSteps, recordNav, routePattern, startTrail, trailSnapshot } from '../trail';

// Picking is tested on its own (pick.test.ts); here it answers what the test says it should.
jest.mock('../pick', () => ({ tapTitle: jest.fn() }));
const tapTitleMock = tapTitle as jest.MockedFunction<typeof tapTitle>;

let stop: () => void = () => {};

beforeEach(() => {
  tapTitleMock.mockReset();
  stop = startTrail();
});

afterEach(() => {
  stop();
});

const kinds = (): string[] => trailSnapshot().map((crumb) => crumb.kind);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function click(target: Element, x = 10, y = 20): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

describe('routePattern', () => {
  it('drops groups and keeps the pattern, never a concrete id', () => {
    expect(routePattern([])).toBe('/');
    expect(routePattern(['(tabs)'])).toBe('/');
    expect(routePattern(['(tabs)', 'feed'])).toBe('/feed');
    expect(routePattern(['(auth)', 'sign-in'])).toBe('/sign-in');
    expect(routePattern(['bev', '[id]'])).toBe('/bev/[id]');
    expect(routePattern(['user', '[id]', 'followers'])).toBe('/user/[id]/followers');
  });
});

describe('the trail', () => {
  it('records a navigation once, and not a repeat of the route on show', () => {
    recordNav('/feed');
    recordNav('/feed');
    recordNav('/bev/[id]');
    recordNav('/feed');
    expect(trailSnapshot().map((crumb) => crumb.route)).toEqual(['/feed', '/bev/[id]', '/feed']);
    expect(trailSnapshot()[0]).toEqual({ at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), kind: 'nav', route: '/feed' });
  });

  it('never keeps a query string or a fragment from a route', () => {
    recordNav('/callback?access_token=secret#frag');
    expect(trailSnapshot()[0]!.route).toBe('/callback');
    recordNav('');
    expect(trailSnapshot()).toHaveLength(1);
  });

  it('records a tap as the name of what was tapped', () => {
    tapTitleMock.mockReturnValue('TabBar › Add Bev');
    const button = document.body.appendChild(document.createElement('button'));
    click(button, 240, 710);
    expect(tapTitleMock).toHaveBeenCalledWith(button, 240, 710);
    expect(trailSnapshot()).toEqual([{ at: expect.any(String), kind: 'tap', target: 'TabBar › Add Bev' }]);
  });

  it('hears a tap even when the app stops the click from bubbling', () => {
    tapTitleMock.mockReturnValue('BevRow · Coca-Cola');
    const row = document.body.appendChild(document.createElement('div'));
    row.addEventListener('click', (event) => event.stopPropagation());
    click(row);
    expect(kinds()).toEqual(['tap']);
  });

  it('skips a tap that cannot be named, such as one on the reporter itself', () => {
    tapTitleMock.mockReturnValue(undefined);
    click(document.body);
    tapTitleMock.mockImplementation(() => {
      throw new Error('no layout');
    });
    click(document.body);
    expect(trailSnapshot()).toEqual([]);
  });

  it('records an uncaught error by its message only, never its stack', () => {
    const error = new Error('Cannot read properties of undefined');
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: x is not a function', error }));
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: error });
    window.dispatchEvent(rejection);
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'plain string reason' }));
    // Nothing to say: not recorded.
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: { code: 1 } }));

    expect(trailSnapshot()).toEqual([
      { at: expect.any(String), kind: 'error', message: 'Uncaught TypeError: x is not a function' },
      { at: expect.any(String), kind: 'error', message: 'Cannot read properties of undefined' },
      { at: expect.any(String), kind: 'error', message: 'plain string reason' },
    ]);
    expect(JSON.stringify(trailSnapshot())).not.toContain('at ');
  });

  it('cuts an error message to 200 characters, on one line', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: `first line\n${'x'.repeat(400)}` }));
    const { message } = trailSnapshot()[0]!;
    expect(message).toHaveLength(200);
    expect(message).not.toContain('\n');
  });

  it('records a failed API call: the method, the code, the time. Never a success, never an argument', async () => {
    const api = observed({
      rankings: {
        submit: (_input: { note: string }) => Promise.reject(new ApiError('conflict', 'Placement moved on')),
        list: () => Promise.resolve([1, 2, 3]),
      },
      bugs: { submit: () => Promise.reject(Object.assign(new Error('boom'), { status: 502 })) },
    });
    await expect(api.rankings.submit({ note: 'what I typed' })).rejects.toThrow('Placement moved on');
    await api.rankings.list();
    await expect(api.bugs.submit()).rejects.toThrow('boom');
    await settle();

    expect(trailSnapshot()).toEqual([
      { at: expect.any(String), kind: 'api', method: 'rankings.submit', code: 'conflict', ms: expect.any(Number) },
      { at: expect.any(String), kind: 'api', method: 'bugs.submit', status: 502, ms: expect.any(Number) },
    ]);
    const text = JSON.stringify(trailSnapshot());
    expect(text).not.toContain('what I typed');
    expect(text).not.toContain('Placement moved on');
  });

  it('never listens for typing', () => {
    stop();
    const onDocument = jest.spyOn(document, 'addEventListener');
    const onWindow = jest.spyOn(window, 'addEventListener');
    stop = startTrail();
    expect(onDocument.mock.calls.map((call) => call[0])).toEqual(['click']);
    expect(onWindow.mock.calls.map((call) => call[0]).sort()).toEqual(['error', 'unhandledrejection']);
    onDocument.mockRestore();
    onWindow.mockRestore();

    const input = document.body.appendChild(document.createElement('input'));
    input.value = 'my password';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(trailSnapshot()).toEqual([]);

    // A tap on the field is recorded by the name pick.ts gives it, which is all the trail asks for.
    tapTitleMock.mockReturnValue('TextField › Password');
    click(input);
    expect(JSON.stringify(trailSnapshot())).not.toContain('my password');
    expect(trailSnapshot()[0]!.target).toBe('TextField › Password');
  });

  it('keeps the most recent 40', () => {
    for (let i = 0; i < 50; i++) recordNav(`/route-${i}`);
    const crumbs = trailSnapshot();
    expect(crumbs).toHaveLength(40);
    expect(crumbs[0]!.route).toBe('/route-10');
    expect(crumbs[39]!.route).toBe('/route-49');
  });

  it('hands out a copy', () => {
    recordNav('/feed');
    const first = trailSnapshot();
    first[0]!.route = '/changed';
    first.push({ at: 'x', kind: 'nav' });
    expect(trailSnapshot()).toEqual([{ at: expect.any(String), kind: 'nav', route: '/feed' }]);
  });

  it('starts once, and stopping removes every listener and empties the buffer', async () => {
    expect(startTrail()).toBe(stop);
    tapTitleMock.mockReturnValue('Header · Feed');
    click(document.body);
    expect(kinds()).toEqual(['tap']);

    stop();
    expect(trailSnapshot()).toEqual([]);
    click(document.body);
    window.dispatchEvent(new ErrorEvent('error', { message: 'after stop' }));
    await observed({ x: () => Promise.reject(new ApiError('network', 'offline')) })
      .x()
      .catch(() => {});
    await settle();
    expect(trailSnapshot()).toEqual([]);

    // Stopping twice is harmless, and it can be started again.
    stop();
    stop = startTrail();
    recordNav('/feed');
    recordNav('/feed');
    expect(kinds()).toEqual(['nav']);
  });
});

describe('recordedSteps', () => {
  const at = '2026-11-13T12:00:00.000Z';
  const crumbs: BugBreadcrumb[] = [
    { at, kind: 'nav', route: '/feed' },
    { at, kind: 'tap', target: 'FeedPost · Coca-Cola' },
    { at, kind: 'api', method: 'bevs.get', code: 'network', ms: 30 },
    { at, kind: 'tap', target: 'FeedPost · Coca-Cola' },
    { at, kind: 'nav', route: '/bev/[id]' },
    { at, kind: 'error', message: 'x is not a function' },
    { at, kind: 'tap', target: 'TabBar › Add Bev' },
    { at, kind: 'tap' },
    { at, kind: 'nav', route: '/lists' },
  ];

  it('words screens and taps as steps, without errors or API failures, collapsing a repeat', () => {
    expect(recordedSteps(crumbs)).toEqual(['Open /feed', 'Tap FeedPost · Coca-Cola', 'Open /bev/[id]', 'Tap TabBar › Add Bev', 'Open /lists']);
  });

  it('keeps the last `max`, 8 by default', () => {
    expect(recordedSteps(crumbs, 2)).toEqual(['Tap TabBar › Add Bev', 'Open /lists']);
    expect(recordedSteps(crumbs, 0)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i): BugBreadcrumb => ({ at, kind: 'nav', route: `/r${i}` }));
    expect(recordedSteps(many)).toEqual(['Open /r12', 'Open /r13', 'Open /r14', 'Open /r15', 'Open /r16', 'Open /r17', 'Open /r18', 'Open /r19']);
    expect(recordedSteps([])).toEqual([]);
  });
});

describe('hadRecentFailure', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

  it('is true for a failed call or an uncaught error in the last minute', () => {
    expect(hadRecentFailure([{ at: ago(5_000), kind: 'api', method: 'bevs.get', code: 'network' }], undefined, now)).toBe(true);
    expect(hadRecentFailure([{ at: ago(59_000), kind: 'error', message: 'x' }], undefined, now)).toBe(true);
  });

  it('is false for an old failure, and for taps and screens however recent', () => {
    expect(hadRecentFailure([{ at: ago(61_000), kind: 'api', method: 'bevs.get' }], undefined, now)).toBe(false);
    expect(hadRecentFailure([{ at: ago(1), kind: 'tap', target: 'x' }, { at: ago(1), kind: 'nav', route: '/feed' }], undefined, now)).toBe(false);
    expect(hadRecentFailure([], undefined, now)).toBe(false);
    expect(hadRecentFailure([{ at: 'not a date', kind: 'error', message: 'x' }], undefined, now)).toBe(false);
  });

  it('takes its own window', () => {
    const crumbs: BugBreadcrumb[] = [{ at: ago(10_000), kind: 'error', message: 'x' }];
    expect(hadRecentFailure(crumbs, 5_000, now)).toBe(false);
    expect(hadRecentFailure(crumbs, 15_000, now)).toBe(true);
  });
});
