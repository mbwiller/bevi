/** @jest-environment jsdom */
import { ApiError, type BugBreadcrumb } from '@bevi/shared';

import { observed } from '@/api/observe';

import { tapTitle } from '../pick';
import { isPickModeOn } from '../pickMode';
import {
  hadRecentFailure,
  isRecordingSteps,
  recordNav,
  routePattern,
  startStepRecording,
  startTrail,
  stopStepRecording,
  trailSnapshot,
} from '../trail';

// Picking and select mode are tested on their own; here they answer what the test says they should.
jest.mock('../pick', () => ({ tapTitle: jest.fn() }));
jest.mock('../pickMode', () => ({ isPickModeOn: jest.fn(() => false) }));
const tapTitleMock = tapTitle as jest.MockedFunction<typeof tapTitle>;
const isPickModeOnMock = isPickModeOn as jest.MockedFunction<typeof isPickModeOn>;

let stop: () => void = () => {};

beforeEach(() => {
  tapTitleMock.mockReset();
  isPickModeOnMock.mockReturnValue(false);
  stop = startTrail();
});

afterEach(() => {
  stopStepRecording();
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

  it('does not record taps: what was tapped in passing is not a ticket\'s business', () => {
    tapTitleMock.mockReturnValue('TabBar › Add Bev');
    const button = document.body.appendChild(document.createElement('button'));
    click(button, 240, 710);
    expect(tapTitleMock).not.toHaveBeenCalled();
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

  it('never listens for typing, or for anything on the page while no steps are being recorded', () => {
    stop();
    const onDocument = jest.spyOn(document, 'addEventListener');
    const onWindow = jest.spyOn(window, 'addEventListener');
    stop = startTrail();
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow.mock.calls.map((call) => call[0]).sort()).toEqual(['error', 'unhandledrejection']);

    // A step recording adds the one click listener, and takes it away again.
    const offDocument = jest.spyOn(document, 'removeEventListener');
    startStepRecording('/feed');
    expect(onDocument.mock.calls.map((call) => [call[0], call[2]])).toEqual([['click', true]]);
    const input = document.body.appendChild(document.createElement('input'));
    input.value = 'my password';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stopStepRecording()).toEqual(['Start on /feed']);
    expect(offDocument.mock.calls.map((call) => [call[0], call[2]])).toEqual([['click', true]]);
    expect(trailSnapshot()).toEqual([]);
    onDocument.mockRestore();
    onWindow.mockRestore();
    offDocument.mockRestore();
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
    recordNav('/feed');
    startStepRecording('/feed');
    expect(kinds()).toEqual(['nav']);

    stop();
    expect(trailSnapshot()).toEqual([]);
    // A recording in progress goes with it.
    expect(isRecordingSteps()).toBe(false);
    tapTitleMock.mockReturnValue('Header · Feed');
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

describe('a step recording', () => {
  let app: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    app = document.body.appendChild(document.createElement('div'));
  });

  it('starts with where it started, and tells the listener each step as it happens', () => {
    const onStep = jest.fn();
    expect(isRecordingSteps()).toBe(false);
    startStepRecording('/lists?tab=want#x', onStep);
    expect(isRecordingSteps()).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(['Start on /lists']);

    tapTitleMock.mockReturnValue('SegmentedTabs › Want to Try');
    click(app, 200, 120);
    expect(tapTitleMock).toHaveBeenCalledWith(app, 200, 120);
    expect(onStep).toHaveBeenLastCalledWith(['Start on /lists', 'Tap SegmentedTabs › Want to Try']);

    tapTitleMock.mockReturnValue('BevRow · Coca-Cola');
    click(app);
    recordNav('/bev/[id]');
    expect(onStep).toHaveBeenCalledTimes(4);
    expect(stopStepRecording()).toEqual(['Start on /lists', 'Tap SegmentedTabs › Want to Try', 'Tap BevRow · Coca-Cola', 'Open /bev/[id]']);
    expect(isRecordingSteps()).toBe(false);
  });

  it('hands the listener a copy each time', () => {
    const seen: string[][] = [];
    startStepRecording('/feed', (steps) => {
      seen.push(steps);
      steps.push('tampered');
    });
    recordNav('/lists');
    expect(seen[0]).not.toBe(seen[1]);
    const steps = stopStepRecording();
    expect(steps).toEqual(['Start on /feed', 'Open /lists']);
    steps.push('tampered');
    expect(stopStepRecording()).toEqual([]);
  });

  it('puts its taps in the trail too, so the ticket shows the reproduction', () => {
    recordNav('/lists');
    startStepRecording('/lists');
    tapTitleMock.mockReturnValue('SegmentedTabs › Top');
    click(app);
    stopStepRecording();
    click(app);
    expect(trailSnapshot()).toEqual([
      { at: expect.any(String), kind: 'nav', route: '/lists' },
      { at: expect.any(String), kind: 'tap', target: 'SegmentedTabs › Top' },
    ]);
  });

  it('hears a tap even when the app stops the click from bubbling', () => {
    startStepRecording('/feed');
    tapTitleMock.mockReturnValue('BevRow · Coca-Cola');
    app.addEventListener('click', (event) => event.stopPropagation());
    click(app);
    expect(stopStepRecording()).toEqual(['Start on /feed', 'Tap BevRow · Coca-Cola']);
  });

  it('never makes a step of a tap on the reporter itself, or of one that cannot be named', () => {
    startStepRecording('/feed');
    // pick.ts answers nothing for the reporter's own UI, and for anything it cannot name.
    tapTitleMock.mockReturnValue(undefined);
    click(app);
    tapTitleMock.mockImplementation(() => {
      throw new Error('no layout');
    });
    click(app);
    expect(stopStepRecording()).toEqual(['Start on /feed']);
    expect(trailSnapshot()).toEqual([]);
  });

  it('records nothing while select mode is on', () => {
    startStepRecording('/feed');
    tapTitleMock.mockReturnValue('FeedPost · Coca-Cola');
    isPickModeOnMock.mockReturnValue(true);
    click(app);
    expect(tapTitleMock).not.toHaveBeenCalled();
    isPickModeOnMock.mockReturnValue(false);
    click(app);
    expect(stopStepRecording()).toEqual(['Start on /feed', 'Tap FeedPost · Coca-Cola']);
  });

  it('does not record the click that selected, when selecting turned select mode off first', () => {
    // Select mode's own listener, added before the recording's, so it hears the click first: it
    // swallows the click (which prevents it) and the UI turns select mode off in the same breath.
    const selecting = (event: Event): void => {
      event.preventDefault();
      isPickModeOnMock.mockReturnValue(false);
    };
    document.addEventListener('click', selecting, true);
    isPickModeOnMock.mockReturnValue(true);
    startStepRecording('/feed');
    tapTitleMock.mockReturnValue('FeedPost · Coca-Cola');
    app.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.removeEventListener('click', selecting, true);
    expect(isPickModeOn()).toBe(false);
    expect(tapTitleMock).not.toHaveBeenCalled();
    expect(stopStepRecording()).toEqual(['Start on /feed']);
  });

  it('collapses a repeat of the last step, and of the screen it is already on', () => {
    startStepRecording('/feed');
    recordNav('/feed');
    tapTitleMock.mockReturnValue('LikeButton · Like');
    click(app);
    click(app);
    recordNav('/bev/[id]');
    recordNav('/bev/[id]');
    click(app);
    recordNav('/feed');
    expect(stopStepRecording()).toEqual(['Start on /feed', 'Tap LikeButton · Like', 'Open /bev/[id]', 'Tap LikeButton · Like', 'Open /feed']);
  });

  it('keeps at most 30 steps', () => {
    const onStep = jest.fn();
    startStepRecording('/feed', onStep);
    for (let i = 0; i < 50; i++) recordNav(`/route-${i}`);
    const steps = stopStepRecording();
    expect(steps).toHaveLength(30);
    expect(steps[0]).toBe('Start on /feed');
    expect(steps[29]).toBe('Open /route-28');
    expect(onStep).toHaveBeenCalledTimes(30);
  });

  it('discards a recording in progress when started again', () => {
    startStepRecording('/feed');
    recordNav('/lists');
    const remove = jest.spyOn(document, 'removeEventListener');
    startStepRecording('/lists');
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
    remove.mockRestore();
    tapTitleMock.mockReturnValue('TabBar › Feed');
    click(app);
    expect(stopStepRecording()).toEqual(['Start on /lists', 'Tap TabBar › Feed']);
  });

  it('answers nothing when no recording is running, and survives a listener that throws', () => {
    expect(stopStepRecording()).toEqual([]);
    startStepRecording('', () => {
      throw new Error('UI bug');
    });
    recordNav('/lists');
    expect(stopStepRecording()).toEqual(['Start on /', 'Open /lists']);
  });

  it('works without the passive trail running', () => {
    stop();
    startStepRecording('/feed');
    tapTitleMock.mockReturnValue('TabBar › Lists');
    click(app);
    recordNav('/lists');
    expect(stopStepRecording()).toEqual(['Start on /feed', 'Tap TabBar › Lists', 'Open /lists']);
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
