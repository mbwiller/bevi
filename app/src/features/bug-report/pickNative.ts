import { Appearance, Dimensions, StyleSheet } from 'react-native';

import type { ColorScheme } from '@/theme/tokens';

import { collapse, createPicker, cut, MAX_TEXT, WALK_LIMIT, type Fiber, type Host, type PickHost, type StyleReader } from './pickCore';
import type { Box, PickLevel } from './types';

/**
 * Which component a touch landed on, on iOS: the React Native half of picking (pick.ts is the DOM
 * half; pickCore.ts walks the fibers and makes the levels for both).
 *
 * There is no hit-testing to do here. UIKit has already decided which view the finger is on, and
 * React Native names that view as the touch event's `target`, an instance that points at its
 * fiber. From there everything is read from React's own tree: a host fiber's props (its label,
 * role and style, as the app wrote them), the text fibers under it, and its box from the renderer
 * (`getBoundingClientRect`, the same synchronous measure a ref has).
 *
 * A host element here is a host fiber's instance (`stateNode`), which the fiber's two copies
 * share; the fiber it was last seen on is remembered so its props and children can be read.
 *
 * Nothing here reads what a person typed: a text field's subtree is never read for text, and of a
 * field only its placeholder is a label.
 */

interface NativeFiber extends Fiber {
  tag?: unknown;
}

/** React's tag for a fiber that is a string inside a `Text`. */
const HOST_TEXT = 6;
/** Enough to tell "short", "cut to 160" and "too long to be a screen's text" apart; no more is ever read. */
const TEXT_READ = MAX_TEXT + 1;
const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox', 'searchbox', 'slider']);

/**
 * A host fiber's native component name ('RCTView', 'RCTText'); '' for every other fiber. A field is
 * told by that name (iOS has 'RCTSinglelineTextInputView' and 'RCTMultilineTextInputView'), which
 * is what keeps its contents from being read: pickNative.test.ts pins the name, so a React Native
 * upgrade that renames it, or a new kind of native field, has to be added here.
 */
const typeOf = (fiber: Fiber): string => (typeof fiber.type === 'string' ? fiber.type : '');
const isInput = (fiber: Fiber): boolean => /TextInput/i.test(typeOf(fiber));
const isText = (fiber: Fiber): boolean => typeOf(fiber) === 'RCTText';
const isScroll = (fiber: Fiber): boolean => /ScrollView/i.test(typeOf(fiber));

function propsOf(fiber: Fiber): Record<string, unknown> {
  const props = fiber.memoizedProps;
  return props && typeof props === 'object' ? (props as Record<string, unknown>) : {};
}

function styleOf(fiber: Fiber): Record<string, unknown> {
  try {
    const flat = StyleSheet.flatten(propsOf(fiber).style as never) as unknown;
    return flat && typeof flat === 'object' ? (flat as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------

let fibers = new WeakMap<Host, Fiber>();

function hostOf(fiber: Fiber): Host | null {
  try {
    const node = fiber.stateNode;
    if (!typeOf(fiber) || !node || typeof node !== 'object') return null;
    fibers.set(node, fiber);
    return node;
  } catch {
    return null;
  }
}

const fiberOf = (element: Host): Fiber | null => fibers.get(element) ?? null;

type Measure = (element: Host) => Box | null;

/**
 * The renderer's own measure: the view's box in the window, in points. `nativeFabricUIManager` is
 * React Native's, not a public API; if an upgrade takes `getBoundingClientRect` away this answers
 * null, nothing has a box, and selecting finds nothing rather than failing.
 */
function measureWithRenderer(element: Host): Box | null {
  const manager = (globalThis as { nativeFabricUIManager?: { getBoundingClientRect?: (node: unknown, includeTransform: boolean) => unknown } })
    .nativeFabricUIManager;
  const node = (element as { node?: unknown }).node;
  if (!node || typeof manager?.getBoundingClientRect !== 'function') return null;
  const rect = manager.getBoundingClientRect(node, true);
  if (!Array.isArray(rect) || rect.length < 4 || !rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, width, height] = rect as [number, number, number, number];
  return { x, y, width, height };
}

let measure: Measure = measureWithRenderer;

function rectOf(element: Host): Box | null {
  try {
    const box = measure(element);
    return box && box.width > 0 && box.height > 0 ? box : null;
  } catch {
    return null;
  }
}

function viewport(): Box {
  const { width, height } = Dimensions.get('window');
  return { x: 0, y: 0, width: width || 0, height: height || 0 };
}

/**
 * The host fibers under `start` (not `start` itself), in the order they are drawn. `visit` answers
 * 'skip' to leave a host's own subtree out and 'stop' to end the walk. A host that is not
 * displayed, and everything in it, is never visited.
 */
function eachHostUnder(start: Fiber, visit: (fiber: Fiber) => 'skip' | 'stop' | void): void {
  const stack: Fiber[] = [];
  if (start.child) stack.push(start.child);
  let visited = 0;
  while (stack.length > 0 && visited < WALK_LIMIT) {
    const fiber = stack.pop()!;
    visited++;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (typeOf(fiber)) {
      if (styleOf(fiber).display === 'none') continue;
      const answer = visit(fiber);
      if (answer === 'stop') return;
      if (answer === 'skip') continue;
    }
    if (fiber.child) stack.push(fiber.child);
  }
}

// ---------------------------------------------------------------------------------------------
// What a host says about itself
// ---------------------------------------------------------------------------------------------

/** A host's label as the app wrote it: its accessibility label, an image's `alt`, a field's placeholder. Never a value. */
function labelOf(fiber: Fiber): string | undefined {
  const props = propsOf(fiber);
  const label = props.accessibilityLabel ?? props['aria-label'] ?? props.alt ?? (isInput(fiber) ? props.placeholder : undefined);
  const clean = typeof label === 'string' ? collapse(label) : '';
  return clean ? cut(clean, MAX_TEXT) : undefined;
}

function roleOf(fiber: Fiber): string | undefined {
  const props = propsOf(fiber);
  const role = props.role ?? props.accessibilityRole;
  if (typeof role === 'string' && role && role !== 'none') return cut(collapse(role), 40);
  return isInput(fiber) ? 'textbox' : undefined;
}

/** Whether a host is something a person presses or types in: a role that says so, a field, or a view that answers a touch. */
function isControl(fiber: Fiber): boolean {
  const role = roleOf(fiber);
  if (role && CONTROL_ROLES.has(role)) return true;
  if (isInput(fiber)) return true;
  const props = propsOf(fiber);
  return !isScroll(fiber) && (typeof props.onClick === 'function' || typeof props.onStartShouldSetResponder === 'function');
}

/** The strings inside one `Text`, joined as they are written; a nested `Text` is part of the same piece. */
function stringsIn(text: Fiber, room: number): string {
  let out = '';
  const stack: Fiber[] = [];
  if (text.child) stack.push(text.child);
  let visited = 0;
  while (stack.length > 0 && visited < WALK_LIMIT && out.length < room) {
    const fiber = stack.pop()! as NativeFiber;
    visited++;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.tag === HOST_TEXT && typeof fiber.memoizedProps === 'string') out += fiber.memoizedProps;
    else if (fiber.child && !isInput(fiber)) stack.push(fiber.child);
  }
  return out;
}

/**
 * The text a host shows, whitespace collapsed, up to TEXT_READ characters: each `Text` is a piece,
 * and pieces are a space apart. A field's subtree and anything not displayed are left out.
 */
function textOf(start: Fiber): string {
  if (isInput(start)) return '';
  if (isText(start)) return collapse(stringsIn(start, TEXT_READ)).slice(0, TEXT_READ);
  const pieces: string[] = [];
  let read = 0;
  eachHostUnder(start, (fiber) => {
    if (isInput(fiber)) return 'skip';
    if (!isText(fiber)) return undefined;
    const piece = collapse(stringsIn(fiber, TEXT_READ - read));
    if (piece) {
      pieces.push(piece);
      read += piece.length + 1;
    }
    return read >= TEXT_READ ? 'stop' : 'skip';
  });
  return collapse(pieces.join(' ')).slice(0, TEXT_READ);
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A host's style as pickCore.ts asks for it, by CSS name. React Native has no computed style: what
 * is read is the style the app gave the host, flattened, which is what a token was written into.
 */
function styleReader(fiber: Fiber): StyleReader {
  const style = styleOf(fiber);
  const first = (...keys: string[]): unknown => keys.map((key) => style[key]).find((value) => value !== undefined && value !== null);
  const px = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? `${value}px` : typeof value === 'string' ? value.trim() : '');
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
  return (name) => {
    switch (name) {
      case 'background-color':
        return text(style.backgroundColor);
      case 'color':
        return text(style.color);
      case 'font-size':
        return px(style.fontSize);
      case 'font-weight':
        return text(style.fontWeight);
      case 'row-gap':
        return px(first('rowGap', 'gap'));
      case 'column-gap':
        return px(first('columnGap', 'gap'));
      case 'opacity':
        return text(style.opacity);
      default:
    }
    const border = /^border-(top|right|bottom|left)-(style|width|color)$/.exec(name);
    if (border) {
      const side = cap(border[1]!);
      if (border[2] === 'style') return text(style.borderStyle) || 'solid';
      if (border[2] === 'width') return px(first(`border${side}Width`, 'borderWidth')) || '0px';
      return text(first(`border${side}Color`, 'borderColor'));
    }
    const corner = /^border-(top|bottom)-(left|right)-radius$/.exec(name);
    if (corner) return px(first(`border${cap(corner[1]!)}${cap(corner[2]!)}Radius`, 'borderRadius')) || '0px';
    const padding = /^padding-(top|right|bottom|left)$/.exec(name);
    if (padding) {
      const side = padding[1]!;
      return px(first(`padding${cap(side)}`, side === 'top' || side === 'bottom' ? 'paddingVertical' : 'paddingHorizontal', 'padding')) || '0px';
    }
    return '';
  };
}

function scheme(): ColorScheme {
  try {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** React Native's host fibers, as pickCore.ts reads them. Every `Host` is an instance `hostOf` produced. */
const NATIVE: PickHost = {
  host: hostOf,
  // A fiber reached from the current tree is on show; there is no detached copy to meet here.
  connected: () => true,
  rect: rectOf,
  viewport,
  column: viewport,
  label: (element) => {
    const fiber = fiberOf(element);
    return fiber ? labelOf(fiber) : undefined;
  },
  role: (element) => {
    const fiber = fiberOf(element);
    return fiber ? roleOf(fiber) : undefined;
  },
  isControl: (element) => {
    const fiber = fiberOf(element);
    return fiber ? isControl(fiber) : false;
  },
  labelled: (element, max) => {
    const found: Host[] = [];
    const fiber = fiberOf(element);
    if (fiber) {
      eachHostUnder(fiber, (inner) => {
        const host = labelOf(inner) ? hostOf(inner) : null;
        if (host) found.push(host);
        return found.length >= max ? 'stop' : undefined;
      });
    }
    return found;
  },
  nameable: (element) => {
    let count = 0;
    const fiber = fiberOf(element);
    if (fiber) {
      eachHostUnder(fiber, (inner) => {
        const role = roleOf(inner);
        if (labelOf(inner) || isInput(inner) || role === 'button' || role === 'tab' || role === 'link') count++;
        return count > 1 ? 'stop' : undefined;
      });
    }
    return count;
  },
  text: (element) => {
    const fiber = fiberOf(element);
    return fiber ? textOf(fiber) : '';
  },
  // The reporter's own layer is drawn beside the app, never under the View that hears the touches.
  isReportUi: () => false,
  style: (element) => {
    const fiber = fiberOf(element);
    return fiber ? styleReader(fiber) : null;
  },
  textHost: (element) => {
    const fiber = fiberOf(element);
    if (!fiber) return null;
    if (isText(fiber)) return stringsIn(fiber, 8).trim() ? element : null;
    let found: Host | null = null;
    eachHostUnder(fiber, (inner) => {
      if (isInput(inner)) return 'skip';
      if (!isText(inner)) return undefined;
      if (!stringsIn(inner, 8).trim()) return 'skip';
      found = hostOf(inner);
      return 'stop';
    });
    return found;
  },
  scheme,
};

const picker = createPicker(NATIVE);

/**
 * The fiber behind a touch event's target. React Native hands a handler the touched view as an
 * instance that holds its fiber (`__internalInstanceHandle`); a fiber itself is accepted too.
 */
export function fiberOfTarget(target: unknown): Fiber | null {
  try {
    if (!target || typeof target !== 'object') return null;
    const handle = (target as { __internalInstanceHandle?: unknown }).__internalInstanceHandle;
    if (handle && typeof handle === 'object') return handle as Fiber;
    const fiber = target as Fiber;
    return typeOf(fiber) && fiber.stateNode && typeof fiber.stateNode === 'object' ? fiber : null;
  } catch {
    return null;
  }
}

/**
 * The components a touch landed on, innermost first, each a component defined in `app/src` whose
 * box differs from the level before it. [] when the target cannot be read or nothing can be named.
 * Never throws.
 */
export function levelsForTarget(target: unknown): PickLevel[] {
  try {
    const fiber = fiberOfTarget(target);
    return fiber ? picker.levels(fiber) : [];
  } catch {
    return [];
  }
}

/**
 * What a tap landed on, for the steps: the title of the control that took it, or of the innermost
 * level when it was not on a control. Undefined when nothing can be named. Never throws, and never
 * reads a field's value.
 */
export function titleForTarget(target: unknown): string | undefined {
  try {
    const fiber = fiberOfTarget(target);
    return fiber ? picker.title(fiber) : undefined;
  } catch {
    return undefined;
  }
}

/** Tests: a measure of their own (there is no renderer to ask under jest), and a fresh memory of hosts. */
export function setMeasureForTests(next: Measure | null): void {
  measure = next ?? measureWithRenderer;
  fibers = new WeakMap();
}
