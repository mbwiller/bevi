import { ApiError, type BugBreadcrumb } from '@bevi/shared';

import { observed } from '@/api/observe';

import { hadRecentFailure, recordNav, routePattern, startStepRecording, startTrail, stopStepRecording, trailSnapshot } from '../trail';

// The iOS file (jest resolves '../trail' as iOS): screens, failed API calls and uncaught errors,
// and no step recording. The web file is trail.web.test.ts.

type Handler = (error: unknown, isFatal?: boolean) => void;
const utils = (globalThis as unknown as { ErrorUtils: { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void } }).ErrorUtils;

/** The observer reports a settled call a tick later. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let stop: () => void = () => {};
let original: Handler;

beforeEach(() => {
  original = utils.getGlobalHandler();
  stop = startTrail();
});
afterEach(() => {
  stop();
  utils.setGlobalHandler(original);
});

describe('the trail on iOS', () => {
  it('records each screen opened by its route pattern, once, and never a concrete path or a query string', () => {
    recordNav('/feed');
    recordNav('/feed');
    recordNav('/bev/[id]');
    recordNav('/search?q=secret#frag');
    expect(trailSnapshot().map((c) => c.route)).toEqual(['/feed', '/bev/[id]', '/search']);
  });

  it('records a failed API call as its method, code and time, and a good one or an argument not at all', async () => {
    const api = observed({
      rankings: {
        submit: (_input: { note: string }) => Promise.reject(new ApiError('network', 'offline')),
        list: () => Promise.resolve([1, 2, 3]),
      },
    });
    await api.rankings.list();
    await expect(api.rankings.submit({ note: 'what I typed' })).rejects.toThrow('offline');
    await settle();
    const calls = trailSnapshot().filter((c) => c.kind === 'api');
    expect(calls).toEqual([{ at: expect.any(String), kind: 'api', method: 'rankings.submit', code: 'network', ms: expect.any(Number) }]);
    expect(JSON.stringify(calls)).not.toContain('what I typed');
    expect(JSON.stringify(calls)).not.toContain('offline');
  });

  it("hears an uncaught error's message, and nothing else of it, and passes it on to the handler that was there", () => {
    const earlier = jest.fn();
    stop();
    utils.setGlobalHandler(earlier);
    stop = startTrail();
    const error = Object.assign(new Error('undefined is not a function'), { stack: 'at secretFile.js:1' });
    utils.getGlobalHandler()(error, false);
    expect(earlier).toHaveBeenCalledWith(error, false);
    const crumbs = trailSnapshot();
    expect(crumbs).toEqual([expect.objectContaining({ kind: 'error', message: 'undefined is not a function' })]);
    expect(JSON.stringify(crumbs)).not.toContain('secretFile');
  });

  it('puts the original error handler back on stopping, unless something replaced ours', () => {
    const earlier = jest.fn();
    stop();
    utils.setGlobalHandler(earlier);
    stop = startTrail();
    expect(utils.getGlobalHandler()).not.toBe(earlier);
    stop();
    expect(utils.getGlobalHandler()).toBe(earlier);

    stop = startTrail();
    const replacement = jest.fn();
    utils.setGlobalHandler(replacement);
    stop();
    expect(utils.getGlobalHandler()).toBe(replacement);
  });

  it('keeps the last 40 entries, oldest first', () => {
    for (let i = 0; i < 50; i++) recordNav(`/screen-${i}`);
    const crumbs = trailSnapshot();
    expect(crumbs).toHaveLength(40);
    expect(crumbs[0]!.route).toBe('/screen-10');
    expect(crumbs[39]!.route).toBe('/screen-49');
  });

  it('is empty again after it is stopped', () => {
    recordNav('/feed');
    stop();
    expect(trailSnapshot()).toEqual([]);
  });

  it('has no step recording: starting one throws (the engine says so), and stopping gives nothing', () => {
    expect(() => startStepRecording('/feed')).toThrow();
    expect(stopStepRecording()).toEqual([]);
  });

  it('turns a route into a pattern and spots a recent failure, as the web does', () => {
    expect(routePattern(['(tabs)', 'feed'])).toBe('/feed');
    expect(routePattern(['bev', '[id]'])).toBe('/bev/[id]');
    const now = new Date('2026-11-19T10:00:00Z');
    const crumbs: BugBreadcrumb[] = [{ at: '2026-11-19T09:59:30Z', kind: 'api', method: 'x' }];
    expect(hadRecentFailure(crumbs, 60_000, now)).toBe(true);
    expect(hadRecentFailure([{ at: '2026-11-19T09:50:00Z', kind: 'error', message: 'x' }], 60_000, now)).toBe(false);
  });
});
