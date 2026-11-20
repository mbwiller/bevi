import { pickAt } from './pick';
import { REPORT_UI_ATTR, type PickLevel, type PickModeHandlers } from './types';

/**
 * Select mode: while it is on, a tap on the app selects the component under it instead of
 * pressing it. Web only.
 *
 * How a tap is kept from the app. react-native-web 0.21 presses in two separate ways, and both
 * have to be cut off:
 *   * its responder system listens on `document`, in the bubble phase, for `mousedown`, `mouseup`,
 *     `touchstart`, `touchend` and `touchcancel` (and the moves between them). That is what gives
 *     a Pressable its pressed look and its long press;
 *   * `onPress` itself is React's `onClick`, the native `click`, which React hears at the root.
 *     An activation from the keyboard is a `keydown`/`keyup` of Enter or Space instead.
 * Every listener here is on `document` in the capture phase, so stopping an event there means
 * neither of those, nor the element itself, ever hears it. Stopping is not enough for what the
 * browser does on its own: `preventDefault` on `mousedown` keeps focus and text selection where
 * they were, on `click` it keeps an `<a href>` from navigating, and on `touchend` it keeps the
 * browser from making up the mouse events and the click that would focus a field and raise the
 * keyboard. `touchstart` and `touchmove` are never prevented (they are listened to passively), so
 * scrolling stays native; a finger or mouse that travelled more than TAP_SLOP is not a tap.
 *
 * Events that start inside `[data-report-ui]` are left exactly as they are.
 */

export type { PickModeHandlers };

/** Further than this between down and up, in CSS px, and it was a scroll or a drag, not a tap. */
const TAP_SLOP = 10;
/** After a touch, the browser may still deliver mouse events and a click it made up from it. */
const TOUCH_ECHO_MS = 700;
/** How long after select mode is turned off a click left over from the selecting tap is still swallowed. */
const LATE_CLICK_MS = 400;
/** How near the selecting tap such a leftover click has to be. */
const LATE_CLICK_SLOP = 30;

interface Point {
  x: number;
  y: number;
}

let handlers: PickModeHandlers | null = null;
let uninstall: (() => void) | null = null;
let dropGuard: (() => void) | null = null;

/** The finger that is down, if one is: where it landed and whether it has travelled. */
let finger: (Point & { id: number; moved: boolean }) | null = null;
/** Where the mouse button went down. */
let pressed: Point | null = null;
/** The last touch event of any kind, and the last touch that ended as a tap on the app. */
let lastTouchAt = 0;
let lastTouchTap: (Point & { at: number }) | null = null;
let hoverFrame: number | null = null;
let hoverNext: (Point & { reporter: boolean }) | null = null;
let hoverCleared = true;

const far = (a: Point, b: Point, slop: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) > slop;

/** Whether an event started in the reporter's own UI, which select mode leaves alone. */
function inReporter(event: Event): boolean {
  const target = event.target as (Node & { closest?: unknown; parentElement?: Element | null }) | null;
  const element = target && typeof target.closest === 'function' ? (target as unknown as Element) : (target?.parentElement ?? null);
  return element !== null && element.closest(`[${REPORT_UI_ATTR}]`) !== null;
}

/** Keeps an event from the element under it, from React and from react-native-web's responder system. */
function swallow(event: Event, preventDefault: boolean): void {
  event.stopPropagation();
  if (preventDefault && event.cancelable) event.preventDefault();
}

function levelsAt(point: Point): PickLevel[] {
  try {
    const levels = pickAt(point.x, point.y);
    return Array.isArray(levels) ? levels : [];
  } catch {
    return [];
  }
}

function hover(levels: PickLevel[]): void {
  if (levels.length === 0 && hoverCleared) return;
  hoverCleared = levels.length === 0;
  try {
    handlers?.onHover(levels);
  } catch {
    // A handler's own error is the UI's to see; select mode carries on.
  }
}

/** A tap at a point: tells the UI what it selected, or nothing when it cannot be named. */
function tap(point: Point): void {
  const levels = levelsAt(point);
  if (levels.length === 0) {
    hover([]);
    return;
  }
  try {
    handlers?.onPick(levels);
  } catch {
    // As above.
  }
}

/** Whether a touch has just happened, so a mouse event now is the browser's echo of it. */
function afterTouch(): boolean {
  const since = Date.now() - lastTouchAt;
  return since >= 0 && since < TOUCH_ECHO_MS;
}

// --- touch -------------------------------------------------------------------------------------

function onTouchStart(event: TouchEvent): void {
  lastTouchAt = Date.now();
  if (inReporter(event)) return;
  swallow(event, false);
  const first = event.changedTouches[0];
  if (event.touches.length > 1 || !first) {
    // A second finger makes it a pinch.
    if (finger) finger.moved = true;
    hover([]);
    return;
  }
  finger = { id: first.identifier, x: first.clientX, y: first.clientY, moved: false };
  // The finger sees what it is on before it lifts.
  hover(levelsAt(finger));
}

function onTouchMove(event: TouchEvent): void {
  lastTouchAt = Date.now();
  if (inReporter(event)) return;
  swallow(event, false);
  if (!finger || finger.moved) return;
  for (const touch of Array.from(event.changedTouches)) {
    if (touch.identifier === finger.id && far(finger, { x: touch.clientX, y: touch.clientY }, TAP_SLOP)) {
      finger.moved = true;
      hover([]);
    }
  }
}

function onTouchEnd(event: TouchEvent): void {
  lastTouchAt = Date.now();
  if (inReporter(event)) return;
  // Prevented whether or not it was a tap: the mouse events and the click the browser would make
  // up from this touch are what focus a field and press a link.
  swallow(event, true);
  const down = finger;
  const up = Array.from(event.changedTouches).find((touch) => touch.identifier === down?.id);
  if (!down || !up) return;
  finger = null;
  const point = { x: up.clientX, y: up.clientY };
  if (down.moved || event.touches.length > 0 || far(down, point, TAP_SLOP)) {
    hover([]);
    return;
  }
  lastTouchTap = { ...point, at: Date.now() };
  tap(point);
}

function onTouchCancel(event: TouchEvent): void {
  lastTouchAt = Date.now();
  if (inReporter(event)) return;
  swallow(event, false);
  finger = null;
  hover([]);
}

// --- mouse -------------------------------------------------------------------------------------

function onMouseDown(event: MouseEvent): void {
  if (inReporter(event)) return;
  swallow(event, true);
  pressed = afterTouch() ? null : { x: event.clientX, y: event.clientY };
}

function onMouseUp(event: MouseEvent): void {
  if (inReporter(event)) return;
  swallow(event, false);
}

function onClick(event: MouseEvent): void {
  if (inReporter(event)) return;
  swallow(event, true);
  const down = pressed;
  pressed = null;
  // Made up by the browser after a touch (the touch has been handled), or by the keyboard (which
  // has no point to select at).
  if (afterTouch() || event.detail === 0) return;
  const point = { x: event.clientX, y: event.clientY };
  if (down && far(down, point, TAP_SLOP)) return;
  tap(point);
}

/** `dblclick`, `auxclick`: a second or middle click presses nothing either. */
function onOtherClick(event: MouseEvent): void {
  if (inReporter(event)) return;
  swallow(event, true);
}

function onMouseMove(event: MouseEvent): void {
  if (afterTouch()) return;
  hoverNext = { x: event.clientX, y: event.clientY, reporter: inReporter(event) };
  if (hoverFrame !== null) return;
  // One pick per frame, however many moves arrive in it.
  hoverFrame = requestFrame(() => {
    hoverFrame = null;
    const next = hoverNext;
    hoverNext = null;
    if (!handlers || !next) return;
    hover(next.reporter ? [] : levelsAt(next));
  });
}

function requestFrame(callback: () => void): number {
  return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : (setTimeout(callback, 16) as unknown as number);
}

function cancelFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  else clearTimeout(frame);
}

/** Pointer events press nothing in react-native-web, but gesture libraries and the map listen for them. */
function onPointer(event: Event): void {
  if (inReporter(event)) return;
  swallow(event, false);
}

// --- keyboard ----------------------------------------------------------------------------------

const isActivation = (event: KeyboardEvent): boolean => event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (!inReporter(event)) {
      swallow(event, true);
      // An open Sheet closes on the Escape `keyup`; this Escape was for select mode only.
      swallowNextEscapeKeyUp();
    }
    try {
      handlers?.onCancel();
    } catch {
      // As above.
    }
    return;
  }
  if (isActivation(event) && !inReporter(event)) swallow(event, true);
}

function onKeyUp(event: KeyboardEvent): void {
  if (isActivation(event) && !inReporter(event)) swallow(event, true);
}

function swallowNextEscapeKeyUp(): void {
  const remove = (): void => {
    clearTimeout(timer);
    document.removeEventListener('keyup', onUp, true);
  };
  const onUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    swallow(event, true);
    remove();
  };
  const timer = setTimeout(remove, 1000);
  document.addEventListener('keyup', onUp, true);
}

// --- on and off --------------------------------------------------------------------------------

function install(): () => void {
  const capture: AddEventListenerOptions = { capture: true, passive: false };
  // Passive: these two are never prevented, which is what keeps scrolling native.
  const scrollSafe: AddEventListenerOptions = { capture: true, passive: true };
  const listeners: [string, (event: never) => void, AddEventListenerOptions][] = [
    ['touchstart', onTouchStart, scrollSafe],
    ['touchmove', onTouchMove, scrollSafe],
    ['touchend', onTouchEnd, capture],
    ['touchcancel', onTouchCancel, capture],
    ['mousedown', onMouseDown, capture],
    ['mouseup', onMouseUp, capture],
    ['mousemove', onMouseMove, scrollSafe],
    ['click', onClick, capture],
    ['dblclick', onOtherClick, capture],
    ['auxclick', onOtherClick, capture],
    ['pointerdown', onPointer, scrollSafe],
    ['pointerup', onPointer, scrollSafe],
    ['pointercancel', onPointer, scrollSafe],
    ['keydown', onKeyDown, capture],
    ['keyup', onKeyUp, capture],
  ];
  for (const [type, listener, options] of listeners) document.addEventListener(type, listener as EventListener, options);
  return () => {
    for (const [type, listener, options] of listeners) document.removeEventListener(type, listener as EventListener, options);
  };
}

/**
 * The selecting tap's own click can still be on its way when the UI turns select mode off inside
 * `onPick`: a browser that did not honour the prevented `touchend` makes up mouse events and a
 * click from that touch, up to 300ms later, and they would press whatever was just selected.
 *
 * Only a touch pick needs this. A mouse pick happens on the `click`, the last event of its
 * gesture, so nothing of that gesture is left to arrive once select mode is off.
 *
 * For the rest of LATE_CLICK_MS after the tap, a `mousedown`, `mouseup` or `click` within
 * LATE_CLICK_SLOP of it is taken for the made-up echo and swallowed (the `mousedown` too, since it
 * is what would focus a field); the first such click ends the guard. A made-up sequence never
 * starts with a `touchstart` or a `pointerdown`, so either of those means a fresh tap by the
 * tester: the guard is dropped at once and the tap is the app's.
 */
function guardLateClick(): void {
  const tapped = lastTouchTap;
  if (!tapped) return;
  const left = LATE_CLICK_MS - (Date.now() - tapped.at);
  if (left <= 0 || left > LATE_CLICK_MS) return;
  const echoes = ['mousedown', 'mouseup', 'click'] as const;
  const fresh = ['touchstart', 'pointerdown'] as const;
  const onLate = (event: MouseEvent): void => {
    if (inReporter(event) || far(tapped, { x: event.clientX, y: event.clientY }, LATE_CLICK_SLOP)) return;
    swallow(event, true);
    if (event.type === 'click') drop();
  };
  const drop = (): void => {
    if (dropGuard !== drop) return;
    dropGuard = null;
    clearTimeout(timer);
    for (const type of echoes) document.removeEventListener(type, onLate, true);
    for (const type of fresh) document.removeEventListener(type, drop, true);
  };
  const timer = setTimeout(drop, left);
  for (const type of echoes) document.addEventListener(type, onLate, true);
  for (const type of fresh) document.addEventListener(type, drop, true);
  dropGuard = drop;
}

/**
 * Turns select mode on and returns the function that turns it off. While it is on:
 *   - a tap or click on the app never reaches the control under it: nothing is pressed, focused,
 *     navigated or submitted;
 *   - scrolling stays native, and a scroll gesture is not a tap; but gestures built on pointer
 *     events, such as panning the map, do not work while selecting (their pointer events are
 *     stopped);
 *   - anything inside `[data-report-ui]` behaves normally (the reporter's own Cancel button);
 *   - the trail records nothing.
 * Off the web it does nothing and returns a no-op. Never throws.
 */
export function startPickMode(next: PickModeHandlers): () => void {
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
    dropGuard?.();
    // Already on: the listeners stay, the new handlers take over, and the old stop does nothing.
    handlers = next;
    uninstall ??= install();

    return (): void => {
      try {
        if (handlers !== next) return;
        handlers = null;
        uninstall?.();
        uninstall = null;
        if (hoverFrame !== null) cancelFrame(hoverFrame);
        hoverFrame = null;
        hoverNext = null;
        hoverCleared = true;
        finger = null;
        pressed = null;
        guardLateClick();
        lastTouchTap = null;
      } catch {
        // Turning off never throws.
      }
    };
  } catch {
    return () => {};
  }
}

/** Whether select mode is on. */
export function isPickModeOn(): boolean {
  return handlers !== null;
}
