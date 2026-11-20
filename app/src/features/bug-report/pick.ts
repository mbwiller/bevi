import type { ColorScheme } from '@/theme/tokens';

import {
  clip,
  collapse,
  componentFile,
  createPicker,
  cut,
  has,
  isAppComponent,
  MAX_TEXT,
  type Fiber,
  type Host,
  type PickHost,
  WALK_LIMIT,
} from './pickCore';
import { REPORT_UI_ATTR, type Box, type PickLevel } from './types';

export { componentFile, isAppComponent };

/**
 * Which component is under a point, on the web: the DOM half of picking. It finds the element under
 * the point and the React fiber behind it, and tells pickCore.ts how to read a DOM element (its
 * box, label, role, text and computed styles); pickCore.ts walks the fibers and makes the levels,
 * the same way it does for iOS (pickNative.ts).
 *
 * Nothing here reads what a person typed: a field and anything editable is skipped when text is
 * read, whatever level it sits under.
 */

const FIBER_KEY = '__reactFiber$';

/** The fiber React attached to a DOM element, if any. */
function fiberOf(element: Element): Fiber | null {
  try {
    for (const key of Object.keys(element)) {
      if (key.startsWith(FIBER_KEY)) {
        const fiber = (element as unknown as Record<string, unknown>)[key];
        return fiber && typeof fiber === 'object' ? (fiber as Fiber) : null;
      }
    }
  } catch {
    // Falls through.
  }
  return null;
}

/** A host fiber's DOM element; null for every other kind of fiber. */
function hostElement(fiber: Fiber): Element | null {
  try {
    const node = fiber.stateNode as { nodeType?: unknown } | null;
    return typeof fiber.type === 'string' && node && node.nodeType === 1 ? (node as unknown as Element) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------------------------

function rectOf(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
}

function viewport(): Box {
  const root = document.documentElement;
  return { x: 0, y: 0, width: window.innerWidth || root.clientWidth || 0, height: window.innerHeight || root.clientHeight || 0 };
}

/**
 * The app column in the viewport: `#root`, which public/index.html holds to 480pt in the middle of
 * a wide window and which is the whole window on a phone. Web only; null when there is no layout.
 */
export function columnBox(): Box | null {
  const frame = viewport();
  const root = document.getElementById('root');
  return clip(root ? rectOf(root) : null, frame) ?? (frame.width > 0 && frame.height > 0 ? frame : null);
}

// ---------------------------------------------------------------------------------------------
// What an element says about itself
// ---------------------------------------------------------------------------------------------

function isEditable(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (element as HTMLElement).isContentEditable === true;
}

/** An element's label as the app wrote it: `aria-label`, an image's `alt`, a field's placeholder. Never a value. */
function labelOf(element: Element): string | undefined {
  const label =
    element.getAttribute('aria-label') ??
    (element.tagName.toLowerCase() === 'img' ? element.getAttribute('alt') : null) ??
    (isEditable(element) ? element.getAttribute('placeholder') : null);
  const clean = label ? collapse(label) : '';
  return clean ? cut(clean, MAX_TEXT) : undefined;
}

const TAG_ROLES: Readonly<Record<string, string>> = {
  a: 'link',
  button: 'button',
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
  img: 'img',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  ul: 'list',
  li: 'listitem',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

function roleOf(element: Element): string | undefined {
  const role = element.getAttribute('role');
  if (role) return cut(collapse(role), 40);
  const tag = element.tagName.toLowerCase();
  return has(TAG_ROLES, tag) ? TAG_ROLES[tag] : undefined;
}

const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox', 'searchbox', 'slider']);

/** Whether an element is something a person presses or types in. react-native-web gives every Pressable `tabindex="0"`. */
function isControl(element: Element): boolean {
  const role = roleOf(element);
  if (role && CONTROL_ROLES.has(role)) return true;
  const tabIndex = element.getAttribute('tabindex');
  return tabIndex !== null && Number(tabIndex) >= 0;
}

const TEXT_TTL_MS = 400;
/** Enough to tell "short", "cut to 160" and "too long to be a screen's text" apart; no more is ever read. */
const TEXT_READ = MAX_TEXT + 1;
let textCache = new WeakMap<Element, { at: number; text: string }>();

const NO_TEXT_TAGS = new Set(['input', 'textarea', 'select', 'option', 'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe']);
const INLINE_TAGS = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'small', 'sub', 'sup', 'u', 's', 'code', 'label', 'abbr', 'mark', 'bdi', 'bdo']);

/** Whether an element's subtree is never read for text: a field, anything editable in place, or something that holds none to show. */
function skipsText(element: Element): boolean {
  if (NO_TEXT_TAGS.has(element.tagName.toLowerCase())) return true;
  const editable = element.getAttribute('contenteditable');
  return (editable !== null && editable !== 'false') || (element as HTMLElement).isContentEditable === true;
}

/** Whether an element is not displayed at all. The other tabs' screens stay mounted that way. */
function isNotDisplayed(element: Element): boolean {
  // No boxes: either `display: none` somewhere above, or `display: contents`, whose children still show.
  return element.getClientRects().length === 0 && window.getComputedStyle(element).display === 'none';
}

/** The nearest ancestor that starts a line of its own; text in two different ones is two pieces. */
function blockOf(node: Node): Element | null {
  let element = node.parentElement;
  while (element && INLINE_TAGS.has(element.tagName.toLowerCase())) element = element.parentElement;
  return element;
}

/**
 * The text an element shows, whitespace collapsed, up to TEXT_READ characters.
 *
 * Read text node by text node rather than with `innerText` or `textContent`, so that what is
 * skipped is decided here: a field (`<input>`, `<textarea>`, `<select>`), anything editable in
 * place and everything under it, so nothing a person typed is ever read, even when the level is
 * the whole screen around the field; the reporter's own UI; and anything not displayed. The walk
 * stops as soon as it has enough, so a long screen costs no more than a short one. A drag asks
 * for the same screen's text many times a second, so each element's answer is kept for a moment.
 */
function textOfElement(element: Element): string {
  const now = Date.now();
  const cached = textCache.get(element);
  if (cached && now - cached.at < TEXT_TTL_MS) return cached.text;
  let text = '';
  try {
    if (!skipsText(element) && !isReportUi(element) && element.closest('[contenteditable]:not([contenteditable="false"])') === null) {
      const walker = document.createTreeWalker(element, 5 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */, {
        acceptNode(node: Node): number {
          if (node.nodeType !== 1) return 1; // FILTER_ACCEPT: a text node
          const child = node as Element;
          if (skipsText(child) || child.hasAttribute(REPORT_UI_ATTR) || isNotDisplayed(child)) return 2; // FILTER_REJECT: skip the subtree
          return child.tagName.toLowerCase() === 'br' ? 1 : 3; // FILTER_SKIP: look inside
        },
      });
      let lastBlock: Element | null = null;
      let seen = 0;
      for (let node = walker.nextNode(); node && text.length < TEXT_READ * 2 && seen < WALK_LIMIT; node = walker.nextNode(), seen++) {
        if (node.nodeType === 1) {
          text += ' ';
          continue;
        }
        const block = blockOf(node);
        if (block !== lastBlock) text += ' ';
        lastBlock = block;
        text += node.nodeValue ?? '';
      }
      text = collapse(text).slice(0, TEXT_READ);
    }
  } catch {
    text = '';
  }
  textCache.set(element, { at: now, text });
  return text;
}

function currentScheme(): ColorScheme {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The first element inside `root` (or `root` itself) that holds text directly: where a component's type style shows. */
function textElement(root: Element): Element | null {
  try {
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = 0;
    for (let node = walker.nextNode(); node && seen < 200; node = walker.nextNode(), seen++) {
      if (node.nodeValue && node.nodeValue.trim() && node.parentElement) return node.parentElement;
    }
  } catch {
    // Falls through.
  }
  return null;
}

function isReportUi(element: Element): boolean {
  return element.closest(`[${REPORT_UI_ATTR}]`) !== null;
}

/** The fiber of an element, or of the nearest ancestor React rendered (a map's own elements have none). */
function nearestFiber(start: Element): Fiber | null {
  let fiber: Fiber | null = null;
  for (let element: Element | null = start; element && !fiber; element = element.parentElement) fiber = fiberOf(element);
  return fiber;
}

/**
 * The topmost element at a point that is the app's: not the reporter's own, and not something
 * laid over the page from outside React (a browser extension, the dev error overlay).
 */
function elementAt(x: number, y: number): Element | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  for (const element of document.elementsFromPoint(x, y)) {
    if (!isReportUi(element) && nearestFiber(element)) return element;
  }
  return null;
}

/** A computed style's values by CSS name, trimmed. */
function styleReader(element: Element): (name: string) => string {
  const style = window.getComputedStyle(element);
  return (name) => (style.getPropertyValue(name) || '').trim();
}

/** The DOM, as pickCore.ts reads it. A `Host` here is always an `Element` that `host` (or this file) produced. */
const DOM: PickHost = {
  host: hostElement,
  connected: (element) => (element as Element).isConnected,
  rect: (element) => rectOf(element as Element),
  viewport,
  column: columnBox,
  label: (element) => labelOf(element as Element),
  role: (element) => roleOf(element as Element),
  isControl: (element) => isControl(element as Element),
  labelled: (element, max) => [...(element as Element).querySelectorAll('[aria-label]')].slice(0, max),
  nameable: (element) =>
    (element as Element).querySelectorAll('[aria-label], [role="button"], [role="tab"], [role="link"], a, button, input, textarea').length,
  text: (element) => textOfElement(element as Element),
  isReportUi: (element) => isReportUi(element as Element),
  style: (element) => styleReader(element as Element),
  textHost: (element): Host | null => textElement(element as Element),
  scheme: currentScheme,
};

const picker = createPicker(DOM);

const onWeb = (): boolean => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * The components under the viewport point (x, y), innermost first. Each level is a component
 * defined in `app/src` whose box differs from the level before it. Elements inside
 * `[data-report-ui]` are skipped. Returns [] off the web, outside the app, or when nothing under
 * the point can be named. Never throws.
 */
export function pickAt(x: number, y: number): PickLevel[] {
  try {
    if (!onWeb()) return [];
    const element = elementAt(x, y);
    if (!element) return [];
    const fiber = nearestFiber(element);
    return fiber ? picker.levels(fiber) : [];
  } catch {
    return [];
  }
}

/**
 * What a tap landed on, for the trail: the title of the control that took it (the row, not the
 * score inside the row), or of the innermost level when the tap was not on a control. `target` is
 * the click's own target; without one the point is used. Undefined when nothing can be named or
 * the tap was on the reporter's own UI. Never throws, and never reads a field's value.
 */
export function tapTitle(target: Element | null | undefined, x: number, y: number): string | undefined {
  try {
    if (!onWeb()) return undefined;
    const usable = target && typeof target.closest === 'function' && target.isConnected ? target : null;
    if (usable && isReportUi(usable)) return undefined;
    const element = usable ?? elementAt(x, y);
    if (!element) return undefined;
    const fiber = nearestFiber(element);
    return fiber ? picker.title(fiber) : undefined;
  } catch {
    return undefined;
  }
}

/** Forgets cached text (tests). */
export function resetPickCache(): void {
  textCache = new WeakMap();
}
