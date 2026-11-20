/** @jest-environment jsdom */
import { pickAt } from '../pick';
import { isPickModeOn, startPickMode, type PickModeHandlers } from '../pickMode.web';
import { REPORT_UI_ATTR, type PickLevel } from '../types';

// Picking is tested on its own (pick.test.ts); here it answers what the test says it should.
jest.mock('../pick', () => ({ pickAt: jest.fn() }));
const pickAtMock = pickAt as jest.MockedFunction<typeof pickAt>;

const level = (title: string): PickLevel => ({ title, box: { x: 0, y: 0, width: 10, height: 10 }, target: { component: title } });
const LEVELS = [level('SegmentedTabs › Bev’d'), level('SegmentedTabs'), level('ListsScreen')];

let handlers: jest.Mocked<PickModeHandlers>;
let stop: () => void = () => {};
/** An app control, with the three ways the app would hear a press on it. */
let control: HTMLElement;
let onControl: jest.Mock;
/** What react-native-web's responder system and React's root listener stand in for: bubble-phase listeners on document. */
let onDocument: jest.Mock;
let reporterButton: HTMLElement;
let onReporter: jest.Mock;

const HEARD = ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'keydown', 'keyup'];

/** Each test starts well after the last one ended, as far as the module's clock can tell. */
let clock = Date.now();

beforeEach(() => {
  clock += 60_000;
  jest.useFakeTimers({ now: clock });
  document.body.innerHTML = '';
  pickAtMock.mockReset();
  pickAtMock.mockReturnValue(LEVELS);

  control = document.body.appendChild(document.createElement('a'));
  // A link, as Expo Router's Link renders one. A fragment, so jsdom can follow it when a test lets a click through.
  control.setAttribute('href', '#bev');
  onControl = jest.fn();
  onDocument = jest.fn();
  const reporter = document.body.appendChild(document.createElement('div'));
  reporter.setAttribute(REPORT_UI_ATTR, 'true');
  reporterButton = reporter.appendChild(document.createElement('button'));
  onReporter = jest.fn();
  for (const type of HEARD) {
    control.addEventListener(type, (event) => onControl(event.type));
    reporterButton.addEventListener(type, (event) => onReporter(event.type));
    document.addEventListener(type, documentListener);
  }

  handlers = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
  stop = startPickMode(handlers);
});

afterEach(() => {
  stop();
  jest.advanceTimersByTime(2000);
  for (const type of HEARD) document.removeEventListener(type, documentListener);
  jest.useRealTimers();
});

function documentListener(event: Event): void {
  onDocument(event.type);
}

function mouse(type: string, target: Element, x = 100, y = 200, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, ...init });
  target.dispatchEvent(event);
  return event;
}

function touch(type: string, target: Element, points: [number, number][], stillDown: [number, number][] = type === 'touchend' ? [] : points): Event {
  const list = (pts: [number, number][]) => pts.map(([clientX, clientY], identifier) => ({ identifier, clientX, clientY, target }));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: list(points) });
  Object.defineProperty(event, 'touches', { value: list(stillDown) });
  target.dispatchEvent(event);
  return event;
}

function key(type: string, target: Element, keyName: string): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: keyName, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const frame = (): void => {
  jest.advanceTimersByTime(20);
};

describe('select mode with a mouse', () => {
  it('selects on a click, and the control under it never hears the press', () => {
    const down = mouse('mousedown', control);
    const up = mouse('mouseup', control);
    const click = mouse('click', control);

    expect(pickAtMock).toHaveBeenCalledWith(100, 200);
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
    expect(handlers.onPick).toHaveBeenCalledWith(LEVELS);
    // Not the element, not React's root, not react-native-web's responder system.
    expect(onControl).not.toHaveBeenCalled();
    expect(onDocument).not.toHaveBeenCalled();
    // No focus or text selection from the mousedown, no navigation from the click.
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(false);
    expect(isPickModeOn()).toBe(true);
  });

  it('swallows a tap on something that cannot be named, without selecting', () => {
    pickAtMock.mockReturnValue([]);
    mouse('mousedown', control);
    const click = mouse('click', control);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(onControl).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('does not select when the pointer travelled more than a tap does', () => {
    mouse('mousedown', control, 100, 200);
    mouse('click', control, 100, 211);
    expect(handlers.onPick).not.toHaveBeenCalled();
    mouse('mousedown', control, 100, 200);
    mouse('click', control, 106, 208);
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
  });

  it('swallows double, middle and keyboard clicks without selecting', () => {
    expect(mouse('dblclick', control).defaultPrevented).toBe(true);
    expect(mouse('auxclick', control, 100, 200, { button: 1 }).defaultPrevented).toBe(true);
    // Enter on a focused link arrives as a click with no pointer behind it.
    expect(mouse('click', control, 0, 0, { detail: 0 }).defaultPrevented).toBe(true);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(onControl).not.toHaveBeenCalled();
  });

  it('reports what is under the pointer once per frame, however often it moves', () => {
    mouse('mousemove', control, 10, 10);
    mouse('mousemove', control, 20, 20);
    mouse('mousemove', control, 30, 30);
    expect(handlers.onHover).not.toHaveBeenCalled();
    frame();
    expect(pickAtMock).toHaveBeenCalledTimes(1);
    expect(pickAtMock).toHaveBeenCalledWith(30, 30);
    expect(handlers.onHover).toHaveBeenCalledWith(LEVELS);

    // Over the reporter's own UI, and over nothing: no highlight, said once.
    mouse('mousemove', reporterButton, 40, 40);
    frame();
    mouse('mousemove', reporterButton, 41, 41);
    frame();
    expect(pickAtMock).toHaveBeenCalledTimes(1);
    expect(handlers.onHover.mock.calls).toEqual([[LEVELS], [[]]]);
  });

  it('leaves the pointer events of gesture libraries without a press to act on', () => {
    control.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    control.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    expect(onControl).not.toHaveBeenCalled();
    expect(onDocument).not.toHaveBeenCalled();
  });
});

describe('select mode with a finger', () => {
  it('shows what the finger is on as it lands, and selects as it lifts', () => {
    const start = touch('touchstart', control, [[100, 200]]);
    expect(handlers.onHover).toHaveBeenCalledWith(LEVELS);
    expect(handlers.onPick).not.toHaveBeenCalled();
    // Never prevented: that is what keeps scrolling native.
    expect(start.defaultPrevented).toBe(false);

    const end = touch('touchend', control, [[102, 203]]);
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
    expect(pickAtMock).toHaveBeenLastCalledWith(102, 203);
    // Prevented: no made-up mouse events, so no focus, no keyboard and no click on the control.
    expect(end.defaultPrevented).toBe(true);
    expect(onControl).not.toHaveBeenCalled();
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('listens to touchstart and touchmove passively', () => {
    stop();
    const add = jest.spyOn(document, 'addEventListener');
    stop = startPickMode(handlers);
    const options = (type: string) => add.mock.calls.find((call) => call[0] === type)?.[2];
    expect(options('touchstart')).toEqual({ capture: true, passive: true });
    expect(options('touchmove')).toEqual({ capture: true, passive: true });
    expect(options('touchend')).toEqual({ capture: true, passive: false });
    expect(options('click')).toEqual({ capture: true, passive: false });
    add.mockRestore();
  });

  it('does not select at the end of a scroll, and takes the highlight away when it starts', () => {
    touch('touchstart', control, [[100, 200]]);
    const move = touch('touchmove', control, [[100, 185]]);
    expect(move.defaultPrevented).toBe(false);
    expect(handlers.onHover).toHaveBeenLastCalledWith([]);
    touch('touchmove', control, [[100, 120]]);
    // Back where it started, but it has been somewhere else.
    touch('touchend', control, [[100, 200]]);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(handlers.onHover).toHaveBeenCalledTimes(2);
  });

  it('does not select with two fingers, or after a cancelled touch', () => {
    touch('touchstart', control, [[100, 200]]);
    touch('touchstart', control, [[150, 250]], [[100, 200], [150, 250]]);
    touch('touchend', control, [[100, 200]], [[150, 250]]);
    expect(handlers.onPick).not.toHaveBeenCalled();

    touch('touchstart', control, [[100, 200]]);
    touch('touchcancel', control, [[100, 200]], []);
    touch('touchend', control, [[100, 200]]);
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('swallows the mouse events and the click a browser makes up after the touch, selecting once', () => {
    touch('touchstart', control, [[100, 200]]);
    touch('touchend', control, [[100, 200]]);
    jest.advanceTimersByTime(300);
    const down = mouse('mousedown', control);
    mouse('mouseup', control);
    const click = mouse('click', control);
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(onControl).not.toHaveBeenCalled();
  });

  it('still swallows that click when the UI turned select mode off as it selected', () => {
    handlers.onPick.mockImplementation(() => stop());
    touch('touchstart', control, [[100, 200]]);
    touch('touchend', control, [[100, 200]]);
    expect(isPickModeOn()).toBe(false);

    // Somewhere else: not the leftover click, so it is the app's.
    mouse('click', control, 300, 500);
    expect(onControl).toHaveBeenLastCalledWith('click');
    onControl.mockClear();

    // The leftover: late, at about the same point.
    jest.advanceTimersByTime(300);
    const down = mouse('mousedown', control, 104, 197);
    const late = mouse('click', control, 104, 197);
    expect(down.defaultPrevented).toBe(true);
    expect(late.defaultPrevented).toBe(true);
    expect(onControl).not.toHaveBeenCalled();
    expect(handlers.onPick).toHaveBeenCalledTimes(1);

    // One click and the guard is gone.
    mouse('click', control, 104, 197);
    expect(onControl).toHaveBeenCalledWith('click');
  });

  it('gives up waiting for that click after 400ms', () => {
    handlers.onPick.mockImplementation(() => stop());
    touch('touchstart', control, [[100, 200]]);
    touch('touchend', control, [[100, 200]]);
    jest.advanceTimersByTime(401);
    const click = mouse('click', control, 100, 200);
    expect(click.defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledWith('click');
  });

  it('drops that guard at once for a fresh tap: a new touchstart (or pointerdown) is never the echo', () => {
    handlers.onPick.mockImplementation(() => stop());
    touch('touchstart', control, [[100, 200]]);
    touch('touchend', control, [[100, 200]]);
    expect(isPickModeOn()).toBe(false);
    jest.advanceTimersByTime(150);
    // The tester taps again near the same spot: the browser honoured the prevented touchend, so no echo came.
    touch('touchstart', control, [[102, 201]]);
    touch('touchend', control, [[102, 201]]);
    const click = mouse('click', control, 102, 201);
    expect(click.defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledWith('click');

    // The same with a pointerdown first.
    stop = startPickMode(handlers);
    touch('touchstart', control, [[100, 200]]);
    touch('touchend', control, [[100, 200]]);
    jest.advanceTimersByTime(100);
    onControl.mockClear();
    control.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(mouse('click', control, 101, 200).defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledWith('click');
  });

  it('arms no guard after a mouse pick: the click was the last event of its gesture', () => {
    handlers.onPick.mockImplementation(() => stop());
    mouse('mousedown', control);
    mouse('click', control);
    expect(handlers.onPick).toHaveBeenCalledTimes(1);
    expect(isPickModeOn()).toBe(false);
    const next = mouse('click', control);
    expect(next.defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledWith('click');
  });

  it('keeps no guard when select mode is turned off by anything but a tap', () => {
    mouse('mousedown', control);
    mouse('click', control);
    stop();
    expect(mouse('click', control).defaultPrevented).toBe(false);
  });
});

describe('select mode and the reporter, the keyboard, on and off', () => {
  it('leaves everything inside the reporter exactly as it is', () => {
    const events = [
      mouse('mousedown', reporterButton),
      mouse('mouseup', reporterButton),
      mouse('click', reporterButton),
      touch('touchstart', reporterButton, [[10, 10]]),
      touch('touchend', reporterButton, [[10, 10]]),
      key('keydown', reporterButton, 'Enter'),
      key('keyup', reporterButton, ' '),
    ];
    expect(onReporter.mock.calls.map((call) => call[0])).toEqual(['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'keydown', 'keyup']);
    expect(onDocument).toHaveBeenCalledTimes(7);
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(handlers.onHover).not.toHaveBeenCalled();
    expect(pickAtMock).not.toHaveBeenCalled();
  });

  it('cancels on Escape, without the Escape closing anything else', () => {
    const down = key('keydown', control, 'Escape');
    const up = key('keyup', control, 'Escape');
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(onDocument).not.toHaveBeenCalled();
    expect(up.defaultPrevented).toBe(true);

    // From inside the reporter it still cancels, and the reporter still hears it.
    key('keydown', reporterButton, 'Escape');
    expect(handlers.onCancel).toHaveBeenCalledTimes(2);
    expect(onReporter).toHaveBeenCalledWith('keydown');
  });

  it('swallows the Escape keyup even when cancelling turned select mode off', () => {
    handlers.onCancel.mockImplementation(() => stop());
    key('keydown', control, 'Escape');
    expect(isPickModeOn()).toBe(false);
    key('keyup', control, 'Escape');
    expect(onDocument).not.toHaveBeenCalled();
    // Only that one.
    jest.advanceTimersByTime(1100);
    key('keyup', control, 'Escape');
    expect(onDocument).toHaveBeenCalledWith('keyup');
  });

  it('keeps Enter and Space from pressing a focused control, and lets other keys through', () => {
    expect(key('keydown', control, 'Enter').defaultPrevented).toBe(true);
    expect(key('keyup', control, 'Enter').defaultPrevented).toBe(true);
    expect(key('keydown', control, ' ').defaultPrevented).toBe(true);
    expect(onControl).not.toHaveBeenCalled();
    expect(key('keydown', control, 'Tab').defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledWith('keydown');
  });

  it('removes every listener when stopped, and stopping twice is safe', () => {
    stop();
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    stop = startPickMode(handlers);
    const added = add.mock.calls.map((call) => call[0]).sort();
    stop();
    stop();
    expect(remove.mock.calls.map((call) => call[0]).sort()).toEqual(added);
    expect(added).toContain('click');
    add.mockRestore();
    remove.mockRestore();

    expect(isPickModeOn()).toBe(false);
    for (const type of ['mousedown', 'mouseup', 'click']) expect(mouse(type, control).defaultPrevented).toBe(false);
    expect(touch('touchend', control, [[1, 1]]).defaultPrevented).toBe(false);
    mouse('mousemove', control);
    frame();
    expect(onControl.mock.calls.map((call) => call[0])).toEqual(['mousedown', 'mouseup', 'click', 'touchend']);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(handlers.onHover).not.toHaveBeenCalled();
  });

  it('drops a hover that was waiting for its frame when stopped', () => {
    mouse('mousemove', control, 10, 10);
    stop();
    frame();
    expect(handlers.onHover).not.toHaveBeenCalled();
  });

  it('replaces the handlers when started while on, and the old stop does nothing', () => {
    const next: jest.Mocked<PickModeHandlers> = { onHover: jest.fn(), onPick: jest.fn(), onCancel: jest.fn() };
    const add = jest.spyOn(document, 'addEventListener');
    const stopNext = startPickMode(next);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();

    stop();
    expect(isPickModeOn()).toBe(true);
    mouse('mousedown', control);
    mouse('click', control);
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(next.onPick).toHaveBeenCalledWith(LEVELS);

    stopNext();
    expect(isPickModeOn()).toBe(false);
    expect(mouse('click', control).defaultPrevented).toBe(false);
  });

  it('carries on when a handler or the picker throws', () => {
    handlers.onPick.mockImplementation(() => {
      throw new Error('UI bug');
    });
    mouse('mousedown', control);
    expect(mouse('click', control).defaultPrevented).toBe(true);
    pickAtMock.mockImplementation(() => {
      throw new Error('no layout');
    });
    expect(mouse('click', control).defaultPrevented).toBe(true);
    expect(onControl).not.toHaveBeenCalled();
    expect(isPickModeOn()).toBe(true);
  });
});
