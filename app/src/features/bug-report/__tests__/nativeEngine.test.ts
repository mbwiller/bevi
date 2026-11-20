import { safeStartPickMode, safeStartStepRecording, safeStopStepRecording } from '../engine';
import { MAX_STEPS } from '../limits';
import { isPickModeOn } from '../pickMode';
import { levelsForTarget, titleForTarget } from '../pickNative';
import { useTouchRoot } from '../touchRoot';
import { recordNav, startTrail, trailSnapshot } from '../trail';
import type { PickLevel } from '../types';

// The engine's guarded entry points as iOS has them (jest resolves './pickMode' and './trail' as
// iOS): select mode and a step recording both hear the app's touches through touchRoot.ts. What a
// touch landed on is pickNative.ts's to say (its own suite), so it is a stand-in here.

jest.mock('../pickNative', () => ({ levelsForTarget: jest.fn(), titleForTarget: jest.fn() }));
const levelsFor = levelsForTarget as jest.MockedFunction<typeof levelsForTarget>;
const titleFor = titleForTarget as jest.MockedFunction<typeof titleForTarget>;

const ROW: PickLevel[] = [{ target: { component: 'BevRow' }, box: { x: 0, y: 100, width: 402, height: 64 }, title: 'BevRow · Coca-Cola' }];
const VIEW = { the: 'view under the finger' };
const at = (target: unknown = VIEW) => ({ target, x: 20, y: 120 });

let stopTrail: () => void;

beforeEach(() => {
  useTouchRoot.setState({ select: null, steps: null });
  levelsFor.mockReset().mockReturnValue(ROW);
  titleFor.mockReset().mockReturnValue('TabBar › Lists');
  stopTrail = startTrail();
});

afterEach(() => {
  safeStopStepRecording();
  stopTrail();
});

describe('select mode on iOS', () => {
  it('asks the touch root for taps, shows what the finger is on, and reports the tap as a selection', () => {
    const handlers = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    const stop = safeStartPickMode(handlers);
    expect(stop).toBeInstanceOf(Function);
    expect(isPickModeOn()).toBe(true);

    const listener = useTouchRoot.getState().select!;
    listener.onDown!(at());
    expect(levelsFor).toHaveBeenLastCalledWith(VIEW);
    expect(handlers.onHover).toHaveBeenLastCalledWith(ROW);

    listener.onDrift!();
    expect(handlers.onHover).toHaveBeenLastCalledWith([]);

    listener.onTap(at());
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
    expect(handlers.onPick).toHaveBeenCalledWith(ROW);

    stop!();
    expect(isPickModeOn()).toBe(false);
    expect(useTouchRoot.getState().select).toBeNull();
  });

  it('a tap on something that cannot be named selects nothing', () => {
    const handlers = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    const stop = safeStartPickMode(handlers)!;
    levelsFor.mockReturnValue([]);
    useTouchRoot.getState().select!.onTap(at());
    expect(handlers.onPick).not.toHaveBeenCalled();
    stop();
  });

  it('started again, the new handlers take over and the old stop does nothing', () => {
    const first = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    const second = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    const stopFirst = safeStartPickMode(first)!;
    const stopSecond = safeStartPickMode(second)!;
    stopFirst();
    expect(isPickModeOn()).toBe(true);
    useTouchRoot.getState().select!.onTap(at());
    expect(first.onPick).not.toHaveBeenCalled();
    expect(second.onPick).toHaveBeenCalledWith(ROW);
    stopSecond();
    expect(useTouchRoot.getState().select).toBeNull();
  });
});

describe('a step recording on iOS', () => {
  it('starts on the screen it was started from, and every screen opened and tap after that is a step', () => {
    const onStep = jest.fn();
    expect(safeStartStepRecording('/feed', onStep)).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(['Start on /feed']);

    const listener = useTouchRoot.getState().steps!;
    // It only watches: there is nothing to take the touch with.
    expect(listener.onDown).toBeUndefined();

    listener.onTap(at());
    expect(titleFor).toHaveBeenLastCalledWith(VIEW);
    recordNav('/lists');
    titleFor.mockReturnValue('BevRow · Coca-Cola');
    listener.onTap(at());
    recordNav('/bev/[id]');

    expect(onStep).toHaveBeenLastCalledWith(['Start on /feed', 'Tap TabBar › Lists', 'Open /lists', 'Tap BevRow · Coca-Cola', 'Open /bev/[id]']);
    // The taps are in the trail too, so the ticket's recent activity shows the reproduction.
    expect(trailSnapshot().filter((crumb) => crumb.kind === 'tap').map((crumb) => crumb.target)).toEqual(['TabBar › Lists', 'BevRow · Coca-Cola']);

    expect(safeStopStepRecording()).toEqual(['Start on /feed', 'Tap TabBar › Lists', 'Open /lists', 'Tap BevRow · Coca-Cola', 'Open /bev/[id]']);
    expect(useTouchRoot.getState().steps).toBeNull();
    expect(safeStopStepRecording()).toEqual([]);
  });

  it('a tap that cannot be named, a repeat of the last step and a tap that selects are not steps', () => {
    safeStartStepRecording('/feed', jest.fn());
    const listener = useTouchRoot.getState().steps!;

    titleFor.mockReturnValue(undefined);
    listener.onTap(at());
    titleFor.mockReturnValue('Pill · Try again');
    listener.onTap(at());
    listener.onTap(at());

    const stopSelect = safeStartPickMode({ onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() })!;
    titleFor.mockReturnValue('TabBar › Profile');
    listener.onTap(at());
    stopSelect();

    expect(safeStopStepRecording()).toEqual(['Start on /feed', 'Tap Pill · Try again']);
  });

  it(`stops at ${MAX_STEPS} steps`, () => {
    safeStartStepRecording('/feed', jest.fn());
    const listener = useTouchRoot.getState().steps!;
    for (let i = 0; i < MAX_STEPS + 10; i++) {
      titleFor.mockReturnValue(`Row ${i}`);
      listener.onTap(at());
    }
    expect(safeStopStepRecording()).toHaveLength(MAX_STEPS);
  });

  it('is discarded when the trail stops, and nothing is listening afterwards', () => {
    safeStartStepRecording('/feed', jest.fn());
    stopTrail();
    expect(useTouchRoot.getState().steps).toBeNull();
    expect(safeStopStepRecording()).toEqual([]);
  });
});
