import type { BugReportTarget } from '@bevi/shared';

// The token values only: `@/theme`'s index also pulls in React Native's `useColorScheme`.
import { colors, radius, spacing, type, type ColorName, type ColorScheme } from '@/theme/tokens';

import { COMPONENT_FILES, DUPLICATE_COMPONENT_FILES, SCREEN_ROUTES } from './componentFiles.generated';
import type { Box, PickLevel } from './types';

/**
 * Which components are above a place in React's tree, and what a ticket says about each: the part
 * of picking that is the same on the web and on iOS. pick.ts (the web) and pickNative.ts (iOS) each
 * find the fiber under a tap and hand this a `PickHost`: how to read a host element's box, label,
 * role, text and styles on their platform (the DOM there, React Native's host fibers here).
 *
 * From that fiber it walks React's fiber tree to the root and keeps the fibers whose component is
 * the app's own (a name in componentFiles.generated.ts), so React Native, react-native-web, Expo
 * Router and Reanimated internals never show up. Each kept component is a level: its name, source
 * file, label, text, props, box and the design tokens it was drawn with. The levels stop at the
 * route's screen; above it are layouts and providers, the same everywhere.
 *
 * Three refinements on "one level per app component", so that a level is the thing a person
 * would name and its file is the one to open:
 *   * a labelled element that is not a component's own root (a tab inside the TabBar, the input
 *     inside a TextField) is a level too, named after the component that owns it:
 *     'TabBar › Add Bev';
 *   * a wrapper, a component that only puts one element around the children its caller gave it
 *     (a pressable, an animation), is named the same way, as a part of the component that used
 *     it: 'BevRow › Cold Brew Black', with BevRow's file;
 *   * a component with nothing to name it inside a labelled control (the Icon inside that tab),
 *     or a helper that only repeats what the labelled component around it shows, is left out.
 *
 * Nothing here reads what a person typed: a prop's string is read only under a presentational
 * name, and the host's `text` is the platform's to keep fields out of.
 *
 * In a production build the names survive because metro.minify.js keeps them, for app/src only.
 */

const MAX_LEVELS = 8;
const MAX_PATH = 8;
export const MAX_TEXT = 160;
const MAX_PROPS = 12;
const MAX_PROP_STRING = 80;
const MAX_STYLES = 12;
/** Titles stay under 60 characters. */
const MAX_TITLE = 59;
/** Text this short can stand in for a label in a title. */
const TITLE_TEXT = 40;
const NO_TOKEN = ' (no token)';

export const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

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
// nothing outside this file and the two platform files touches a fiber's fields. If React changes
// them, picking quietly finds nothing; it never throws.
// ---------------------------------------------------------------------------------------------

export interface Fiber {
  type?: unknown;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;
  stateNode?: unknown;
  memoizedProps?: unknown;
}

/** Longer than any real tree is deep or wide; only there so a cycle cannot hang the app. */
export const WALK_LIMIT = 2000;

/**
 * A host element as its platform holds it: a DOM `Element` on the web, a host fiber's instance on
 * iOS. Opaque here: only the `PickHost` that made it reads it, and two of them are the same
 * element exactly when they are the same object.
 */
export type Host = object;

/** A computed style's value by its CSS name ('background-color', 'padding-top'), trimmed; '' when it has none. */
export type StyleReader = (name: string) => string;

/** How one platform reads its host elements. Every method may be called for any element it produced. */
export interface PickHost {
  /** A host fiber's element; null for every other kind of fiber. */
  host(fiber: Fiber): Host | null;
  /** Whether the element is still part of what is on show. */
  connected(element: Host): boolean;
  /** Where it is in the viewport; null when it has no area. */
  rect(element: Host): Box | null;
  viewport(): Box;
  /** The app's column in the viewport: the whole window on a phone. */
  column(): Box | null;
  /** Its label as the app wrote it, never a value. */
  label(element: Host): string | undefined;
  role(element: Host): string | undefined;
  /** Whether it is something a person presses or types in. */
  isControl(element: Host): boolean;
  /** Up to `max` labelled elements inside it (not itself). */
  labelled(element: Host, max: number): Host[];
  /** How many things to press or name are inside it; counting may stop at two. */
  nameable(element: Host): number;
  /** The text it shows, never a field's contents. */
  text(element: Host): string;
  /** Whether it is the reporter's own. */
  isReportUi(element: Host): boolean;
  style(element: Host): StyleReader | null;
  /** The first element inside it (or itself) that holds text directly: where a component's type style shows. */
  textHost(element: Host): Host | null;
  scheme(): ColorScheme;
}

/**
 * A composite fiber's component name: `displayName ?? name`, looking through `memo` and
 * `forwardRef`. A display name that only decorates the function's own name is read as that name:
 * in development Expo Router labels a route's component 'FeedScreen(./(tabs)/feed/index.tsx)'.
 */
export function componentName(fiber: Fiber): string | null {
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
 * Prop names that may hold what a person typed, a credential or contact details. A prop with such
 * a name is never read, whatever its type. Deliberately broad (`pinned` and `keyboardType` match
 * too): leaving out a harmless prop costs a ticket nothing.
 */
const SENSITIVE_PROP = /^(value|defaultValue|text|query)$|pass|secret|token|auth|cookie|key|pin|otp|code|email|phone/i;

/**
 * The only props whose strings are read: names that say how a component is drawn or labelled.
 * A string under any other name (an id, a URL, a note, a message) is dropped, because nothing
 * about an unknown name says its value is not somebody's content.
 */
const STRING_PROPS: ReadonlySet<string> = new Set([
  // which variation of the component
  'variant',
  'scoreVariant',
  'size',
  'tone',
  'accent',
  'kind',
  'type',
  'mode',
  'state',
  'status',
  'bucket',
  'active',
  // how it is laid out and drawn
  'align',
  'direction',
  'layout',
  'snap',
  'position',
  'shape',
  'weight',
  'color',
  // what it is called on screen
  'icon',
  'name',
  'label',
  'title',
  'placeholder',
  'prefix',
  'action',
  'role',
  'accessibilityRole',
  'accessibilityLabel',
  // how a field behaves
  'inputMode',
  'autoCapitalize',
  'autoComplete',
]);

/**
 * A fiber's props that say something in a ticket. Numbers and booleans are kept unless the name
 * is a sensitive one; a string is kept only under a name on the list above, and only a short one.
 * Never `children`, a style, a handler, an object, or what a person typed.
 */
function scalarProps(fiber: Fiber): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  try {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== 'object') return undefined;
    for (const key of Object.keys(props)) {
      if (count >= MAX_PROPS) break;
      if (key === 'children' || key === 'style' || key === 'testID' || key.startsWith('on') || SENSITIVE_PROP.test(key)) continue;
      const value = (props as Record<string, unknown>)[key];
      const kept =
        typeof value === 'string'
          ? STRING_PROPS.has(key) && value.length <= MAX_PROP_STRING
          : typeof value === 'number'
            ? Number.isFinite(value)
            : typeof value === 'boolean';
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

export function union(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** `box` cut to `frame`; null when nothing of it is inside. */
export function clip(box: Box | null, frame: Box): Box | null {
  if (!box) return null;
  const x = Math.max(box.x, frame.x);
  const y = Math.max(box.y, frame.y);
  const width = Math.min(box.x + box.width, frame.x + frame.width) - x;
  const height = Math.min(box.y + box.height, frame.y + frame.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
const sameBox = (a: Box, b: Box): boolean => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const rounded = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
export const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// ---------------------------------------------------------------------------------------------
// Design tokens: how an element was drawn
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

/** `colors.primary` for a colour either scheme's tokens hold (the scheme on show first), else its hex and "(no token)". */
function colorToken(color: Rgba, use: ColorUse, scheme: ColorScheme): string {
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
  /** Not a component of its own: a labelled element inside `owner` that is not its root, or a wrapper `owner` put around something. */
  part: boolean;
  /** For a wrapper: its name and its fiber. */
  wrapper?: AppFiber;
  elements: Host[];
  box: Box;
  screen: boolean;
  /** A label taken over from a level drawn in exactly the same place that was dropped. */
  inherited?: Naming;
  naming?: Naming;
}

interface Tree {
  /** The app components from the element up, innermost first, ending at the route's screen when there is one. Wrappers are not among them. */
  apps: AppFiber[];
  found: Found[];
}

function fitTitle(head: string, joiner: string, detail: string): string {
  const room = MAX_TITLE - head.length - joiner.length;
  return room < 4 || !detail ? cut(head, MAX_TITLE) : `${head}${joiner}${cut(detail, room)}`;
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

/** What a platform gets back for its `PickHost`. Neither function throws. */
export interface Picker {
  /** The app components above `fiber`, innermost first, each one a level whose box differs from the one before it. */
  levels(fiber: Fiber): PickLevel[];
  /**
   * What a tap that landed on `fiber` is called in the steps: the title of the control that took it
   * (the row, not the score inside the row), or of the innermost level when it was not on a control.
   */
  title(fiber: Fiber): string | undefined;
}

export function createPicker(dom: PickHost): Picker {
  /**
   * The host elements a component renders at its top: its nearest host descendants. An element with
   * no box of its own (`display: contents` on the web) is looked through.
   */
  function rootHosts(fiber: Fiber): Host[] {
    const hosts: Host[] = [];
    try {
      const stack: Fiber[] = [];
      if (fiber.child) stack.push(fiber.child);
      let visited = 0;
      while (stack.length > 0 && visited < WALK_LIMIT && hosts.length < 64) {
        const node = stack.pop()!;
        visited++;
        if (node.sibling) stack.push(node.sibling);
        const element = dom.host(node);
        if (element && !dom.connected(element)) continue;
        if (element && dom.rect(element)) {
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

  /**
   * Whether a component is only a wrapper: one element around the children its caller gave it, with
   * nothing of its own inside (`<Animated.View style={…}>{children}</Animated.View>`). What such a
   * component shows is written in its caller's file, not its own. Told by identity: the one element
   * it renders has, as its children, the very object the component was given as `children`.
   */
  function wrapsChildren(fiber: Fiber): boolean {
    try {
      const children = (fiber.memoizedProps as { children?: unknown } | null | undefined)?.children;
      if (!children || typeof children !== 'object') return false;
      let node = fiber.child;
      for (let depth = 0; node && depth < 12; depth++, node = node.child) {
        if (node.sibling) return false;
        if (dom.host(node)) return (node.memoizedProps as { children?: unknown } | null | undefined)?.children === children;
      }
    } catch {
      // Falls through.
    }
    return false;
  }

  function boxOf(elements: readonly Host[]): Box | null {
    let box: Box | null = null;
    for (const element of elements) box = union(box, dom.rect(element));
    return clip(box, dom.viewport());
  }

  /**
   * How an element was drawn, as token names where one matches. `typography` is false for a level
   * that holds a screenful of text, where one element's font says nothing about the whole.
   */
  function stylesOf(element: Host, typography: boolean): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    let count = 0;
    const put = (name: string, value: string): void => {
      if (count < MAX_STYLES) {
        out[name] = value;
        count++;
      }
    };
    try {
      const get = dom.style(element);
      if (!get) return undefined;

      const fill = parseColor(get('background-color'));
      if (fill && fill[3] > 0) put('backgroundColor', colorToken(fill, 'fill', dom.scheme()));

      const textHolder = typography ? dom.textHost(element) : null;
      const textGet = textHolder ? (textHolder === element ? get : dom.style(textHolder)) : null;
      if (textGet) {
        const ink = parseColor(textGet('color'));
        if (ink && ink[3] > 0) put('color', colorToken(ink, 'text', dom.scheme()));
        const fontSize = textGet('font-size');
        const size = pixels(fontSize);
        const weight = weightOf(textGet('font-weight') || '400');
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
        if (line && line[3] > 0) put('borderColor', colorToken(line, 'border', dom.scheme()));
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

  /** The app components above a fiber, and the levels they make. */
  function treeFrom(fiber: Fiber): Tree {
    const chain = fiberChain(fiber);
    const apps: AppFiber[] = [];
    const wrappers = new Map<Fiber, string>();
    let screenAt = -1;
    for (const link of chain) {
      if (dom.host(link)) continue;
      const name = componentName(link);
      if (!isAppComponent(name)) continue;
      const screen = has(SCREEN_ROUTES, name);
      if (!screen && wrapsChildren(link)) {
        wrappers.set(link, name);
        continue;
      }
      if (screen) screenAt = apps.length;
      apps.push({ fiber: link, name });
    }
    if (screenAt >= 0) apps.length = screenAt + 1;

    const found: Found[] = [];
    let labelled: Host[] = [];
    let next = 0;
    /** The labelled elements passed since the last level, as parts of the component they are in; not `own`, which label the level itself. */
    const flushParts = (own: readonly Host[]): void => {
      for (const part of labelled) {
        if (own.includes(part)) continue;
        const box = boxOf([part]);
        if (box) found.push({ owner: next, part: true, elements: [part], box, screen: false });
      }
      labelled = [];
    };
    for (const link of chain) {
      if (next >= apps.length) break;
      const element = dom.host(link);
      if (element) {
        if (dom.label(element)) labelled.push(element);
        continue;
      }
      const wrapper = wrappers.get(link);
      if (wrapper === undefined && link !== apps[next]!.fiber) continue;
      const hosts = rootHosts(link);
      flushParts(hosts);
      const box = boxOf(hosts);
      if (wrapper !== undefined) {
        // A wrapper is a part of the component that used it: that is whose file says what it shows.
        if (box) found.push({ owner: next, part: true, elements: hosts, box, screen: false, wrapper: { fiber: link, name: wrapper } });
        continue;
      }
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
      const label = dom.label(element);
      if (label) return { label, role: dom.role(element), control: dom.isControl(element) };
    }
    if (!level.part) {
      try {
        const area = level.box.width * level.box.height;
        const candidates = level.elements.flatMap((element) => dom.labelled(element, 3)).slice(0, 3);
        for (const candidate of candidates) {
          const box = clip(dom.rect(candidate), level.box);
          const label = dom.label(candidate);
          if (label && box && box.width * box.height >= area * 0.7 && !dom.isReportUi(candidate)) {
            return { label, role: dom.role(candidate), control: dom.isControl(candidate) };
          }
        }
      } catch {
        // Falls through.
      }
    }
    if (level.inherited) return level.inherited;
    const first = level.elements[0];
    return { role: first ? dom.role(first) : undefined, control: level.elements.some((element) => dom.isControl(element)) };
  }

  /** Whether a level holds more than one thing to press or name: its text is then a row of labels, not a name for it. */
  function holdsSeveral(level: Found): boolean {
    try {
      let count = 0;
      for (const element of level.elements) {
        count += dom.nameable(element);
        if (count > 1) return true;
      }
    } catch {
      // Falls through.
    }
    return false;
  }

  /** Text short enough, and single enough, to name a level that has no label. */
  function namingText(level: Found): string | undefined {
    const text = textOf(level);
    return text && text.length <= TITLE_TEXT && !holdsSeveral(level) ? text : undefined;
  }

  function inherit(level: Found, from: Found): void {
    const theirs = namingOf(from);
    if (theirs.label === undefined || namingOf(level).label !== undefined) return;
    level.inherited = theirs;
    level.naming = undefined;
  }

  function textOf(level: Found): string {
    return collapse(level.elements.slice(0, 20).map((element) => dom.text(element)).join(' '));
  }

  /**
   * The levels to offer, innermost first. Left out, in this order: a component or wrapper with
   * nothing to name it inside a labelled control (the Icon in a tab); a helper with no label that
   * shows only what the labelled component around it, from the same file, shows (the number inside
   * a ScoreBubble); a level drawn exactly where the one inside it is; and all but eight.
   */
  function levelsOf(tree: Tree): Found[] {
    let levels = tree.found;

    const control = levels.findIndex((level) => namingOf(level).control && namingOf(level).label !== undefined);
    if (control > 0) {
      levels = levels.filter((level, i) => i >= control || namingOf(level).label !== undefined || textOf(level) !== '');
    }
    // From the outside in, so a helper inside a helper is measured against the component that stays.
    const said: Found[] = [];
    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i]!;
      const outer = said[0];
      const repeats =
        outer !== undefined &&
        !level.part &&
        !outer.part &&
        namingOf(level).label === undefined &&
        namingOf(outer).label !== undefined &&
        fileOf(tree, level.owner) === fileOf(tree, outer.owner) &&
        textOf(level) === textOf(outer);
      if (!repeats) said.unshift(level);
    }
    levels = said;

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


  /**
   * A level's short name. 'TabBar › Add Bev' for a labelled part of a component; 'BevRow · Coca-Cola'
   * for a component with a label, or else with text that names it; otherwise 'FeedPost › Pill', the
   * component under the one that uses it. The same string goes in the steps.
   */
  function titleOf(tree: Tree, level: Found): string {
    const name = tree.apps[level.owner]!.name;
    const { label } = namingOf(level);
    if (level.part) return fitTitle(name, ' › ', label ?? level.wrapper?.name ?? '');
    // A screen or a layout is its name, whatever it happens to say and whatever is above it.
    if (level.screen || fileOf(tree, level.owner)?.endsWith('/_layout.tsx')) return cut(name, MAX_TITLE);
    const detail = label ?? namingText(level);
    if (detail) return fitTitle(name, ' · ', detail);
    const parent = tree.apps[level.owner + 1]?.name;
    return parent ? fitTitle(parent, ' › ', name) : cut(name, MAX_TITLE);
  }


  function describe(tree: Tree, level: Found): PickLevel {
    const box = level.box;
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
    const column = dom.column();
    const wholeScreen = level.screen || (column !== null && level.box.width * level.box.height >= column.width * column.height * 0.8);
    if (text && !(wholeScreen && text.length > MAX_TEXT)) target.text = cut(text, MAX_TEXT);

    // A labelled element has no props of its own; a wrapper's are the wrapper's.
    const props = level.part ? (level.wrapper ? scalarProps(level.wrapper.fiber) : undefined) : scalarProps(app.fiber);
    if (props) target.props = props;
    target.rect = rounded(box);
    const first = level.elements[0];
    const styles = first ? stylesOf(first, text.length <= MAX_TEXT) : undefined;
    if (styles) target.styles = styles;

    return { target, box, title: titleOf(tree, level) };
  }

  return {
    levels(fiber) {
      try {
        const tree = treeFrom(fiber);
        return levelsOf(tree).map((level) => describe(tree, level));
      } catch {
        return [];
      }
    },
    title(fiber) {
      try {
        const tree = treeFrom(fiber);
        const levels = levelsOf(tree);
        const level = levels.find((candidate) => namingOf(candidate).control) ?? levels[0];
        return level ? titleOf(tree, level) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
