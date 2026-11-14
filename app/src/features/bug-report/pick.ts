import type { BugReportTarget } from '@bevi/shared';

// The token values only: `@/theme`'s index also pulls in React Native's `useColorScheme`.
import { colors, radius, spacing, type, type ColorName, type ColorScheme } from '@/theme/tokens';

import { COMPONENT_FILES, DUPLICATE_COMPONENT_FILES, SCREEN_ROUTES } from './componentFiles.generated';
import { REPORT_UI_ATTR, type Box, type PickLevel } from './types';

/**
 * Which component is under a point. Web only: it reads the DOM and the React fibers behind it.
 *
 * From the element under the point it walks React's fiber tree to the root and keeps the fibers
 * whose component is the app's own (a name in componentFiles.generated.ts), so React Native,
 * react-native-web, Expo Router and Reanimated internals never show up. Each kept component is a
 * level: its name, source file, label, text, props, box and the design tokens it was drawn with.
 * The levels stop at the route's screen; above it are layouts and providers, the same everywhere.
 *
 * Two refinements on "one level per app component":
 *   * a labelled element that is not a component's own root (a tab inside the TabBar, the input
 *     inside a TextField) is a level too, named after the component that owns it:
 *     'TabBar › Add Bev';
 *   * a component with no label and no text of its own that sits inside a labelled control (the
 *     Icon inside that tab) is left out, so the first level is the thing a person would name.
 *
 * Nothing here reads what a person typed: never a field's value, and never a `value` prop.
 *
 * In a production build the names survive because metro.minify.js keeps them, for app/src only.
 */

const MAX_LEVELS = 8;
const MAX_PATH = 8;
const MAX_TEXT = 160;
const MAX_PROPS = 12;
const MAX_PROP_STRING = 80;
const MAX_STYLES = 12;
/** Titles stay under 60 characters. */
const MAX_TITLE = 59;
/** Text this short can stand in for a label in a title. */
const TITLE_TEXT = 40;
const NO_TOKEN = ' (no token)';

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** Whether a component name is one the app defines in app/src (componentFiles.generated.ts). */
export function isAppComponent(name: string | null | undefined): name is string {
  return typeof name === 'string' && has(COMPONENT_FILES, name);
}

/** The repo-relative source file of an app component, or undefined when the manifest does not know the name. */
export function componentFile(name: string): string | undefined {
  return isAppComponent(name) ? COMPONENT_FILES[name] : undefined;
}

// ---------------------------------------------------------------------------------------------
// React internals. Fibers are not a public API: every read is defensive, nothing is written, and
// nothing outside the five functions of this section touches a fiber's fields. If React changes
// them, picking quietly finds nothing; it never throws.
// ---------------------------------------------------------------------------------------------

interface Fiber {
  type?: unknown;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;
  stateNode?: unknown;
  memoizedProps?: unknown;
}

const FIBER_KEY = '__reactFiber$';
/** Longer than any real tree is deep or wide; only there so a cycle cannot hang the page. */
const WALK_LIMIT = 2000;

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

/**
 * A composite fiber's component name: `displayName ?? name`, looking through `memo` and
 * `forwardRef`. A display name that only decorates the function's own name is read as that name:
 * in development Expo Router labels a route's component 'FeedScreen(./(tabs)/feed/index.tsx)'.
 */
function componentName(fiber: Fiber): string | null {
  try {
    let current: unknown = fiber.type;
    for (let depth = 0; depth < 4; depth++) {
      if (typeof current === 'function') {
        const fn = current as { displayName?: unknown; name?: unknown };
        const own = typeof fn.name === 'string' ? fn.name : '';
        const display = typeof fn.displayName === 'string' ? fn.displayName : '';
        const name = display && !(own && display.startsWith(`${own}(`)) ? display : own;
        return name || null;
      }
      if (!current || typeof current !== 'object') return null;
      const wrapper = current as { displayName?: unknown; type?: unknown; render?: unknown };
      if (typeof wrapper.displayName === 'string' && wrapper.displayName) return wrapper.displayName;
      current = wrapper.type ?? wrapper.render;
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

/**
 * The fibers from `start` to the root, innermost first, each swapped for its current version.
 *
 * React keeps two copies of every fiber and a DOM element may point at either; an old copy's props
 * and children are a render behind. The root knows which root fiber is current, and a current
 * fiber's children are current, so from the root down each step takes whichever copy its (current)
 * parent actually lists. Where that cannot be told the fiber is kept as found.
 */
function fiberChain(start: Fiber): Fiber[] {
  const chain: Fiber[] = [];
  try {
    for (let fiber: Fiber | null | undefined = start; fiber && chain.length < WALK_LIMIT; fiber = fiber.return) chain.push(fiber);
    const top = chain[chain.length - 1];
    const root = top?.stateNode as { current?: Fiber } | null | undefined;
    let parent = root && typeof root === 'object' ? root.current : undefined;
    if (!top || !parent || (parent !== top && parent !== top.alternate)) return chain;
    chain[chain.length - 1] = parent;
    for (let i = chain.length - 2; i >= 0; i--) {
      const found: Fiber = chain[i]!;
      let listed: Fiber | null = null;
      let steps = 0;
      for (let child = parent.child; child && steps < WALK_LIMIT; child = child.sibling, steps++) {
        if (child === found || child === found.alternate) {
          listed = child;
          break;
        }
      }
      if (listed) chain[i] = listed;
      parent = chain[i]!;
    }
  } catch {
    // Keep what was collected.
  }
  return chain;
}

/**
 * The DOM elements a component renders at its top: its nearest host descendants. An element with
 * no box of its own (`display: contents`) is looked through.
 */
function rootHosts(fiber: Fiber): Element[] {
  const hosts: Element[] = [];
  try {
    const stack: Fiber[] = [];
    if (fiber.child) stack.push(fiber.child);
    let visited = 0;
    while (stack.length > 0 && visited < WALK_LIMIT && hosts.length < 64) {
      const node = stack.pop()!;
      visited++;
      if (node.sibling) stack.push(node.sibling);
      const element = hostElement(node);
      if (element && !element.isConnected) continue;
      if (element && rectOf(element)) {
        hosts.push(element);
        continue;
      }
      if (node.child) stack.push(node.child);
    }
  } catch {
    // Keep what was collected.
  }
  return hosts;
}

/** Props that hold what a person typed, or a credential. */
const TYPED_PROP = /^(value|defaultValue|text|query)$|password|secret|token/i;

/** A fiber's props that say something in a ticket: scalars only, and never what a person typed. */
function scalarProps(fiber: Fiber): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  try {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== 'object') return undefined;
    for (const key of Object.keys(props)) {
      if (count >= MAX_PROPS) break;
      if (key === 'children' || key === 'style' || key === 'testID' || key.startsWith('on') || TYPED_PROP.test(key)) continue;
      const value = (props as Record<string, unknown>)[key];
      const kept =
        typeof value === 'string' ? value.length <= MAX_PROP_STRING : typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean';
      if (!kept) continue;
      out[key] = value as string | number | boolean;
      count++;
    }
  } catch {
    // Keep what was collected.
  }
  return count > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------------------------

function rectOf(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function viewport(): Box {
  const root = document.documentElement;
  return { x: 0, y: 0, width: window.innerWidth || root.clientWidth || 0, height: window.innerHeight || root.clientHeight || 0 };
}

/** `box` cut to `frame`; null when nothing of it is inside. */
function clip(box: Box | null, frame: Box): Box | null {
  if (!box) return null;
  const x = Math.max(box.x, frame.x);
  const y = Math.max(box.y, frame.y);
  const width = Math.min(box.x + box.width, frame.x + frame.width) - x;
  const height = Math.min(box.y + box.height, frame.y + frame.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function boxOf(elements: readonly Element[]): Box | null {
  let box: Box | null = null;
  for (const element of elements) box = union(box, rectOf(element));
  return clip(box, viewport());
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
const sameBox = (a: Box, b: Box): boolean => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const rounded = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });

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

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

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
let textCache = new WeakMap<Element, { at: number; text: string }>();

/**
 * The text an element shows, whitespace collapsed. `innerText` leaves out what is not displayed
 * (the other tabs' screens stay mounted) and never includes a field's value. A drag asks for the
 * same screen's text many times a second, so each element's answer is kept for a moment.
 */
function textOfElement(element: Element): string {
  if (isEditable(element)) return '';
  const now = Date.now();
  const cached = textCache.get(element);
  if (cached && now - cached.at < TEXT_TTL_MS) return cached.text;
  let text = '';
  try {
    if (!element.querySelector('[contenteditable]:not([contenteditable="false"])')) {
      const shown: unknown = (element as HTMLElement).innerText;
      text = collapse(typeof shown === 'string' ? shown : (element.textContent ?? ''));
    }
  } catch {
    text = '';
  }
  textCache.set(element, { at: now, text });
  return text;
}

// ---------------------------------------------------------------------------------------------
// Styles, as design tokens
// ---------------------------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

function parseHex(hex: string): Rgba | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, match[2] ? parseInt(match[2], 16) / 255 : 1];
}

/** A computed colour: 'rgb(74, 42, 132)', 'rgba(0, 0, 0, 0.65)', 'rgb(0 0 0 / 65%)' or a hex. */
function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text.startsWith('#')) return parseHex(text);
  if (text === 'transparent') return [0, 0, 0, 0];
  const match = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string): number => Math.round(part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const rgba: Rgba = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!), alpha];
  return rgba.every((n) => Number.isFinite(n)) ? rgba : null;
}

const sameColor = (a: Rgba, b: Rgba): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && Math.abs(a[3] - b[3]) <= 0.011;

function toHex(color: Rgba): string {
  const byte = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${byte(color[0])}${byte(color[1])}${byte(color[2])}${color[3] < 0.995 ? byte(color[3] * 255) : ''}`;
}

type ColorUse = 'text' | 'fill' | 'border';

/** Several tokens share a value (`surface`, `onPrimary` and `onDeep` are all white in light): which names fit each use, best first. */
const COLOR_ORDER: Readonly<Record<ColorUse, readonly ColorName[]>> = {
  text: ['text', 'textSecondary', 'primary', 'onPrimary', 'onDeep', 'onScore'],
  fill: ['surface', 'input', 'primary', 'primaryTint', 'avatarFill', 'tasteCard', 'scrim', 'photoScrim', 'glassFill'],
  border: ['border', 'borderStrong', 'primary', 'glassStroke', 'glassHighlight'],
};

function currentScheme(): ColorScheme {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** `colors.primary` for a colour either scheme's tokens hold (the scheme on show first), else its hex and "(no token)". */
function colorToken(color: Rgba, use: ColorUse): string {
  const scheme = currentScheme();
  const names = [...COLOR_ORDER[use], ...(Object.keys(colors.light) as ColorName[])];
  for (const palette of [colors[scheme], colors[scheme === 'dark' ? 'light' : 'dark']]) {
    for (const name of names) {
      const token = parseHex(palette[name]);
      if (token && sameColor(token, color)) return `colors.${name}`;
    }
  }
  return `${toHex(color)}${NO_TOKEN}`;
}

function pixels(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** `spacing.md` / `radius.pill` for a length a token holds, else the length and "(no token)". */
function lengthToken(value: string, family: 'spacing' | 'radius'): string {
  const n = pixels(value);
  const scale: Readonly<Record<string, number>> = family === 'spacing' ? spacing : radius;
  if (n !== null) {
    for (const name of Object.keys(scale)) if (scale[name] === n) return `${family}.${name}`;
  }
  return `${value.trim()}${NO_TOKEN}`;
}

function isZeroLength(value: string): boolean {
  const text = value.trim();
  return text === '' || text === '0' || pixels(text) === 0 || text === '0%';
}

const weightOf = (value: string): number => (value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value));

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

/**
 * How an element was drawn, as token names where one matches. `typography` is false for a level
 * that holds a screenful of text, where one element's font says nothing about the whole.
 */
function stylesOf(element: Element, typography: boolean): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let count = 0;
  const put = (name: string, value: string): void => {
    if (count < MAX_STYLES) {
      out[name] = value;
      count++;
    }
  };
  try {
    const style = window.getComputedStyle(element);
    const get = (name: string): string => (style.getPropertyValue(name) || '').trim();

    const fill = parseColor(get('background-color'));
    if (fill && fill[3] > 0) put('backgroundColor', colorToken(fill, 'fill'));

    const textHolder = typography ? textElement(element) : null;
    if (textHolder) {
      const textStyle = textHolder === element ? style : window.getComputedStyle(textHolder);
      const ink = parseColor(textStyle.getPropertyValue('color') || '');
      if (ink && ink[3] > 0) put('color', colorToken(ink, 'text'));
      const fontSize = (textStyle.getPropertyValue('font-size') || '').trim();
      const size = pixels(fontSize);
      const weight = weightOf((textStyle.getPropertyValue('font-weight') || '400').trim());
      if (size !== null && size > 0) {
        const names = Object.keys(type) as (keyof typeof type)[];
        const match = names.find((name) => type[name].fontSize === size && Number(type[name].fontWeight) === weight);
        if (match) put('fontSize', `type.${match}`);
        else {
          put('fontSize', `${fontSize}${NO_TOKEN}`);
          if (Number.isFinite(weight) && weight !== 400) put('fontWeight', String(weight));
        }
      }
    }

    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const widths = sides.map((side) => (get(`border-${side}-style`) === 'none' ? '0px' : get(`border-${side}-width`)));
    const drawn = sides.findIndex((_, i) => !isZeroLength(widths[i]!));
    if (drawn >= 0) {
      const line = parseColor(get(`border-${sides[drawn]}-color`));
      if (line && line[3] > 0) put('borderColor', colorToken(line, 'border'));
      const shown = widths.map((width) => (isZeroLength(width) ? '0px' : width));
      put('borderWidth', shown.every((width) => width === shown[0]) ? shown[0]! : shown.join(' '));
    }

    const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => get(`border-${corner}-radius`));
    if (corners.some((corner) => !isZeroLength(corner))) {
      put('borderRadius', corners.every((corner) => corner === corners[0]) ? lengthToken(corners[0]!, 'radius') : corners.join(' '));
    }

    const [top, right, bottom, left] = sides.map((side) => get(`padding-${side}`)) as [string, string, string, string];
    const pad = (name: string, value: string): void => {
      if (!isZeroLength(value)) put(name, lengthToken(value, 'spacing'));
    };
    if (top === right && top === bottom && top === left) pad('padding', top);
    else if (top === bottom && left === right) {
      pad('paddingVertical', top);
      pad('paddingHorizontal', left);
    } else {
      pad('paddingTop', top);
      pad('paddingRight', right);
      pad('paddingBottom', bottom);
      pad('paddingLeft', left);
    }

    const rowGap = get('row-gap');
    const gap = pixels(rowGap) ? rowGap : get('column-gap');
    if (pixels(gap)) put('gap', lengthToken(gap, 'spacing'));

    const opacity = get('opacity');
    if (opacity !== '' && Number(opacity) < 1) put('opacity', String(Math.round(Number(opacity) * 100) / 100));
  } catch {
    // Keep what was collected.
  }
  return count > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------------------------

interface AppFiber {
  fiber: Fiber;
  name: string;
}

interface Naming {
  label?: string;
  role?: string;
  /** Whether the labelled element (or, with no label, any root element) is a control. */
  control: boolean;
}

/** One level before it is described. Describing reads styles and text, so it waits until the level is known to be kept. */
interface Found {
  /** Index into `Tree.apps`: the component this level is, or for a labelled part the component that owns it. */
  owner: number;
  /** A labelled element inside `owner` that is not its root. */
  part: boolean;
  elements: Element[];
  box: Box;
  screen: boolean;
  /** A label taken over from a level drawn in exactly the same place that was dropped. */
  inherited?: Naming;
  naming?: Naming;
}

interface Tree {
  /** The app components from the element up, innermost first, ending at the route's screen when there is one. */
  apps: AppFiber[];
  found: Found[];
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

/** The app components above an element, and the levels they make. */
function treeFrom(start: Element): Tree {
  const fiber = nearestFiber(start);
  if (!fiber) return { apps: [], found: [] };

  const chain = fiberChain(fiber);
  const apps: AppFiber[] = [];
  let screenAt = -1;
  for (const link of chain) {
    if (hostElement(link)) continue;
    const name = componentName(link);
    if (!isAppComponent(name)) continue;
    if (has(SCREEN_ROUTES, name)) screenAt = apps.length;
    apps.push({ fiber: link, name });
  }
  if (screenAt >= 0) apps.length = screenAt + 1;

  const found: Found[] = [];
  let labelled: Element[] = [];
  let next = 0;
  for (const link of chain) {
    if (next >= apps.length) break;
    const element = hostElement(link);
    if (element) {
      if (labelOf(element)) labelled.push(element);
      continue;
    }
    if (link !== apps[next]!.fiber) continue;
    const hosts = rootHosts(link);
    for (const part of labelled) {
      if (hosts.includes(part)) continue;
      const box = boxOf([part]);
      if (box) found.push({ owner: next, part: true, elements: [part], box, screen: false });
    }
    labelled = [];
    const box = boxOf(hosts);
    if (box) found.push({ owner: next, part: false, elements: hosts, box, screen: next === screenAt });
    next++;
  }
  return { apps, found };
}

/** What names a level: a label on a root element, else on the one labelled element that fills it, else one it inherited. */
function namingOf(level: Found): Naming {
  if (level.naming) return level.naming;
  const naming = readNaming(level);
  level.naming = naming;
  return naming;
}

function readNaming(level: Found): Naming {
  for (const element of level.elements) {
    const label = labelOf(element);
    if (label) return { label, role: roleOf(element), control: isControl(element) };
  }
  if (!level.part) {
    try {
      const area = level.box.width * level.box.height;
      const candidates = level.elements.flatMap((element) => [...element.querySelectorAll('[aria-label]')].slice(0, 3)).slice(0, 3);
      for (const candidate of candidates) {
        const box = clip(rectOf(candidate), level.box);
        const label = labelOf(candidate);
        if (label && box && box.width * box.height >= area * 0.7 && !isReportUi(candidate)) {
          return { label, role: roleOf(candidate), control: isControl(candidate) };
        }
      }
    } catch {
      // Falls through.
    }
  }
  if (level.inherited) return level.inherited;
  const first = level.elements[0];
  return { role: first ? roleOf(first) : undefined, control: level.elements.some(isControl) };
}

function inherit(level: Found, from: Found): void {
  const theirs = namingOf(from);
  if (theirs.label === undefined || namingOf(level).label !== undefined) return;
  level.inherited = theirs;
  level.naming = undefined;
}

function textOf(level: Found): string {
  return collapse(level.elements.slice(0, 20).map(textOfElement).join(' '));
}

/**
 * The levels to offer, innermost first: components with nothing to name them inside a labelled
 * control are dropped, then a level drawn exactly where the one inside it is, then all but eight.
 */
function levelsOf(tree: Tree): Found[] {
  let levels = tree.found;

  const control = levels.findIndex((level) => namingOf(level).control && namingOf(level).label !== undefined);
  if (control > 0) {
    levels = levels.filter((level, i) => i >= control || level.part || namingOf(level).label !== undefined || textOf(level) !== '');
  }

  const kept: Found[] = [];
  for (const level of levels) {
    const inner = kept[kept.length - 1];
    if (!inner || !sameBox(inner.box, level.box)) {
      kept.push(level);
    } else if (inner.part && !level.part && inner.owner === level.owner) {
      // A labelled element that fills its component is the component: keep the one with the props.
      inherit(level, inner);
      kept[kept.length - 1] = level;
    } else if (level.screen) {
      kept.push(level);
    } else {
      // The inner one is the more specific name; a label the wrapper carried still names it.
      inherit(inner, level);
    }
  }

  if (kept.length <= MAX_LEVELS) return kept;
  const last = kept[kept.length - 1]!;
  return last.screen ? [...kept.slice(0, MAX_LEVELS - 1), last] : kept.slice(0, MAX_LEVELS);
}

function fitTitle(head: string, joiner: string, detail: string): string {
  const room = MAX_TITLE - head.length - joiner.length;
  return room < 4 ? cut(head, MAX_TITLE) : `${head}${joiner}${cut(detail, room)}`;
}

/**
 * A level's short name. 'TabBar › Add Bev' for a labelled part of a component; 'BevRow · Coca-Cola'
 * for a component with a label, or else with text short enough to name it; otherwise
 * 'FeedPost › Pill', the component under its parent. The same string goes in the trail.
 */
function titleOf(tree: Tree, level: Found): string {
  const name = tree.apps[level.owner]!.name;
  const { label } = namingOf(level);
  if (level.part) return label ? fitTitle(name, ' › ', label) : cut(name, MAX_TITLE);
  if (label) return fitTitle(name, ' · ', label);
  const text = textOf(level);
  if (text && text.length <= TITLE_TEXT) return fitTitle(name, ' · ', text);
  const parent = tree.apps[level.owner + 1]?.name;
  return parent ? fitTitle(parent, ' › ', name) : cut(name, MAX_TITLE);
}

/** The file a component is defined in. For a name several files define, the one a neighbour in the tree comes from. */
function fileOf(tree: Tree, index: number): string | undefined {
  const name = tree.apps[index]!.name;
  const candidates = has(DUPLICATE_COMPONENT_FILES, name) ? DUPLICATE_COMPONENT_FILES[name] : undefined;
  if (candidates) {
    for (const neighbour of [index + 1, index - 1, index + 2, index - 2]) {
      const other = tree.apps[neighbour]?.name;
      if (other === undefined || has(DUPLICATE_COMPONENT_FILES, other)) continue;
      const file = COMPONENT_FILES[other];
      if (file && candidates.includes(file)) return file;
    }
  }
  return COMPONENT_FILES[name];
}

function describe(tree: Tree, level: Found, box: Box = level.box): PickLevel {
  const app = tree.apps[level.owner]!;
  const { label, role } = namingOf(level);
  const target: BugReportTarget = { component: app.name };

  target.path = tree.apps
    .slice(level.owner, level.owner + MAX_PATH)
    .map((a) => a.name)
    .reverse();
  const file = fileOf(tree, level.owner);
  if (file) target.file = file;
  if (label) target.label = label;
  if (role) target.role = role;

  const text = textOf(level);
  const column = columnBox();
  const wholeScreen = level.screen || (column !== null && level.box.width * level.box.height >= column.width * column.height * 0.8);
  if (text && !(wholeScreen && text.length > MAX_TEXT)) target.text = cut(text, MAX_TEXT);

  const props = level.part ? undefined : scalarProps(app.fiber);
  if (props) target.props = props;
  target.rect = rounded(box);
  const first = level.elements[0];
  const styles = first ? stylesOf(first, text.length <= MAX_TEXT) : undefined;
  if (styles) target.styles = styles;

  return { target, box, title: titleOf(tree, level) };
}

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
    const tree = treeFrom(element);
    return levelsOf(tree).map((level) => describe(tree, level));
  } catch {
    return [];
  }
}

/**
 * The whole screen as one level: the current route's screen component, with the app column as its
 * box. Null off the web. Never throws.
 */
export function pickScreen(): PickLevel | null {
  try {
    if (!onWeb()) return null;
    const column = columnBox();
    if (!column) return null;
    const element = elementAt(column.x + column.width / 2, column.y + column.height / 2);
    if (!element) return null;
    const tree = treeFrom(element);
    // The screen is the outermost level. A splash or a config error has no route screen; there the
    // outermost component stands in.
    const level = tree.found.filter((found) => !found.part).pop();
    if (!level) return null;
    level.screen = true;
    return describe({ apps: tree.apps, found: [level] }, level, column);
  } catch {
    return null;
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
    const tree = treeFrom(element);
    const levels = levelsOf(tree);
    const level = levels.find((candidate) => namingOf(candidate).control) ?? levels[0];
    return level ? titleOf(tree, level) : undefined;
  } catch {
    return undefined;
  }
}

/** Forgets cached text (tests). */
export function resetPickCache(): void {
  textCache = new WeakMap();
}
