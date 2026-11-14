/** @jest-environment jsdom */
import { columnBox, pickAt, pickScreen, resetPickCache, tapTitle } from '../pick';
import { REPORT_UI_ATTR } from '../types';

// A small manifest of its own, so the app gaining or losing a component never changes these tests.
jest.mock('../componentFiles.generated', () => ({
  COMPONENT_FILES: {
    BevImage: 'app/src/components/BevImage.tsx',
    BevRow: 'app/src/components/BevRow.tsx',
    FeedPost: 'app/src/components/FeedPost.tsx',
    FeedPostItem: 'app/src/features/feed/FeedPostItem.tsx',
    FeedScreen: 'app/src/features/feed/FeedScreen.tsx',
    Header: 'app/src/components/Header.tsx',
    Icon: 'app/src/components/Icon.tsx',
    RankFlow: 'app/src/features/ranking/RankFlow.tsx',
    RootLayout: 'app/src/app/_layout.tsx',
    ScoreBubble: 'app/src/components/ScoreBubble.tsx',
    Screen: 'app/src/features/onboarding/starter/StarterStep.tsx',
    Spacer: 'app/src/components/Spacer.tsx',
    TabBar: 'app/src/components/TabBar.tsx',
    TabIcon: 'app/src/components/TabBar.tsx',
    TabsLayout: 'app/src/app/(tabs)/_layout.tsx',
    TextField: 'app/src/components/TextField.tsx',
  },
  DUPLICATE_COMPONENT_FILES: {
    Screen: ['app/src/features/onboarding/starter/StarterStep.tsx', 'app/src/features/ranking/RankFlow.tsx'],
  },
  SCREEN_ROUTES: { FeedScreen: 'app/src/app/(tabs)/feed/index.tsx' },
}));

// ---------------------------------------------------------------------------------------------
// A DOM built by hand with fake fibers behind it: objects with the fields pick.ts reads.
// ---------------------------------------------------------------------------------------------

interface FakeFiber {
  type: unknown;
  return: FakeFiber | null;
  child: FakeFiber | null;
  sibling: FakeFiber | null;
  alternate?: FakeFiber | null;
  stateNode: unknown;
  memoizedProps: unknown;
}

type Rect = [x: number, y: number, width: number, height: number];

interface HostOptions {
  rect: Rect;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  text?: string;
}

function attach(parent: FakeFiber, children: FakeFiber[]): FakeFiber {
  parent.child = children[0] ?? null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] ?? null;
  });
  return parent;
}

/** A host fiber and its element. The element's children are appended by `mount`. */
function host(tag: string, options: HostOptions, children: FakeFiber[] = []): FakeFiber {
  const element = document.createElement(tag);
  const [x, y, width, height] = options.rect;
  element.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
  for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
  for (const [name, value] of Object.entries(options.style ?? {})) element.style.setProperty(name, value);
  if (options.text !== undefined) element.appendChild(document.createTextNode(options.text));
  const fiber: FakeFiber = { type: tag, return: null, child: null, sibling: null, stateNode: element, memoizedProps: {} };
  (element as unknown as Record<string, unknown>).__reactFiber$test = fiber;
  return attach(fiber, children);
}

function component(type: unknown, props: Record<string, unknown>, children: FakeFiber[]): FakeFiber {
  return attach({ type, return: null, child: null, sibling: null, stateNode: null, memoizedProps: props }, children);
}

/** Puts each host element under the element of its nearest host ancestor, as React would. */
function mount(fiber: FakeFiber, into: Element): void {
  const element = typeof fiber.type === 'string' ? (fiber.stateNode as Element) : null;
  if (element) into.appendChild(element);
  for (let child = fiber.child; child; child = child.sibling) mount(child, element ?? into);
}

const el = (fiber: FakeFiber): HTMLElement => fiber.stateNode as HTMLElement;
const under = (...fibers: FakeFiber[]): void => {
  document.elementsFromPoint = jest.fn(() => fibers.map(el));
};

// The app's components, by name, and the kinds of thing around them that must be ignored.
const named = (name: string): (() => null) => Object.defineProperty(() => null, 'name', { value: name });
const memo = (name: string) => ({ $$typeof: Symbol.for('react.memo'), type: named(name), compare: null });
const forwardRef = (name: string) => ({ $$typeof: Symbol.for('react.forward_ref'), render: named(name) });
const Pressable = named('Pressable');
const View = named('View');

const LONG_TEXT = 'A paragraph long enough that no title would ever use it as a name for anything at all. '.repeat(3).trim();

interface Scene {
  root: FakeFiber;
  svg: FakeFiber;
  tabIcon: FakeFiber;
  addBev: FakeFiber;
  nav: FakeFiber;
  header: FakeFiber;
  post: FakeFiber;
  row: FakeFiber;
  image: FakeFiber;
  score: FakeFiber;
  field: FakeFiber;
  input: FakeFiber;
  screen: FakeFiber;
}

/** A feed screen with a header, one post holding a row, a search field, and the tab bar under it. */
function scene(): Scene {
  const svg = host('svg', { rect: [228, 701, 24, 24] });
  const tabIcon = host('div', { rect: [217, 690, 46, 46], style: { 'background-color': 'rgb(74, 42, 132)' } }, [component(named('Icon'), { name: 'plus', size: 24 }, [svg])]);
  const addBev = host('div', { rect: [192, 690, 96, 78], attrs: { role: 'button', 'aria-label': 'Add Bev', tabindex: '0' } }, [
    component(named('TabIcon'), { on: false }, [tabIcon]),
  ]);
  const nav = host(
    'nav',
    {
      rect: [0, 700, 480, 68],
      attrs: { 'aria-label': 'Main' },
      style: { 'background-color': 'rgb(255, 255, 255)', 'border-top-width': '1px', 'border-top-style': 'solid', 'border-top-color': 'rgb(227, 227, 230)' },
    },
    [component(Pressable, { onPress: () => {} }, [addBev])],
  );
  const tabBar = component(named('TabBar'), { active: 'feed', safeArea: true, onChange: () => {} }, [component(View, {}, [nav])]);

  const header = host('div', {
    rect: [0, 0, 480, 44],
    text: 'Feed',
    style: {
      'background-color': 'rgb(74, 42, 132)',
      color: 'rgb(255, 255, 255)',
      'font-size': '20px',
      'font-weight': '700',
      'padding-top': '12px',
      'padding-right': '12px',
      'padding-bottom': '12px',
      'padding-left': '12px',
      'border-top-left-radius': '13px',
      'border-top-right-radius': '13px',
      'border-bottom-right-radius': '13px',
      'border-bottom-left-radius': '13px',
      opacity: '0.5',
    },
  });
  const headerComponent = component(
    named('Header'),
    {
      title: 'Feed',
      count: 3,
      large: true,
      children: 'never',
      style: { flex: 1 },
      testID: 'header',
      onBack: () => {},
      onlineStatus: 'kept: only handlers are skipped',
      tooLong: 'x'.repeat(81),
      justFits: 'y'.repeat(80),
      object: { a: 1 },
      list: [1, 2],
      nothing: null,
      missing: undefined,
      notANumber: Number.NaN,
      value: 'what someone typed',
      defaultValue: 'what someone typed',
      password: 'hunter2',
      authToken: 'abc',
    },
    [header],
  );

  const image = host('div', { rect: [16, 60, 94, 94] });
  const score = host('div', {
    rect: [400, 80, 40, 40],
    text: '8.2',
    style: { 'background-color': 'rgb(1, 2, 3)', color: 'rgb(255, 255, 255)', 'font-size': '14px', 'font-weight': '600', 'padding-top': '4px', 'padding-bottom': '4px', 'padding-left': '13px', 'padding-right': '13px' },
  });
  const row = host('div', { rect: [16, 60, 448, 94], attrs: { role: 'button', 'aria-label': 'Coca-Cola, 8.2', tabindex: '0' } }, [
    component(named('BevImage'), { size: 94 }, [image]),
    component(named('ScoreBubble'), { score: 8.2, bucket: 'LOVED' }, [score]),
  ]);
  const post = host('div', { rect: [0, 44, 480, 300], text: LONG_TEXT }, [component(named('BevRow'), { rank: 1 }, [component(Pressable, {}, [row])])]);
  const postItem = component(memo('FeedPostItem'), { following: true }, [component(named('FeedPost'), { variant: 'feed' }, [post])]);

  const input = host('input', { rect: [20, 364, 440, 40], attrs: { 'aria-label': 'Search Bevs' } });
  (el(input) as HTMLInputElement).value = 'secret typed words';
  const field = host('div', { rect: [16, 360, 448, 48] }, [input]);
  const textField = component(forwardRef('TextField'), { label: 'Search', value: 'secret typed words' }, [field]);

  const screen = host('div', { rect: [0, 0, 480, 700] }, [headerComponent, postItem, textField]);
  const feed = component(named('FeedScreen'), {}, [screen]);

  const tabs = host('div', { rect: [0, 0, 480, 768] }, [component(named('SceneView'), {}, [feed]), tabBar]);
  const root = host('div', { rect: [0, 0, 480, 768], attrs: { id: 'root' } }, [component(named('TabsLayout'), {}, [tabs])]);
  mount(component(named('RootLayout'), {}, [root]), document.body);
  return { root, svg, tabIcon, addBev, nav, header, post, row, image, score, field, input, screen };
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetPickCache();
  under();
});

describe('pickAt', () => {
  it('returns the app components under the point, innermost first, up to the screen', () => {
    const s = scene();
    under(s.score, s.row, s.post, s.screen, s.root);
    const levels = pickAt(420, 100);
    expect(levels.map((level) => level.title)).toEqual(['ScoreBubble · 8.2', 'BevRow · Coca-Cola, 8.2', 'FeedPostItem › FeedPost', 'FeedScreen']);
    expect(levels.map((level) => level.box)).toEqual([
      { x: 400, y: 80, width: 40, height: 40 },
      { x: 16, y: 60, width: 448, height: 94 },
      { x: 0, y: 44, width: 480, height: 300 },
      { x: 0, y: 0, width: 480, height: 700 },
    ]);
    // Nothing above the screen: layouts are the same on every screen.
    expect(levels.map((level) => level.target.component)).not.toContain('TabsLayout');
  });

  it('describes each level for a ticket: file, ancestry, label, role, text, rect', () => {
    const s = scene();
    under(s.score);
    const [score, row, , screen] = pickAt(420, 100);
    expect(score!.target).toMatchObject({
      component: 'ScoreBubble',
      path: ['FeedScreen', 'FeedPostItem', 'FeedPost', 'BevRow', 'ScoreBubble'],
      file: 'app/src/components/ScoreBubble.tsx',
      text: '8.2',
      props: { score: 8.2, bucket: 'LOVED' },
      rect: { x: 400, y: 80, width: 40, height: 40 },
    });
    expect(score!.target.route).toBeUndefined();
    expect(row!.target).toMatchObject({ component: 'BevRow', label: 'Coca-Cola, 8.2', role: 'button', file: 'app/src/components/BevRow.tsx' });
    // A whole screen's text is left out when it is long; a smaller level's is cut to 160.
    expect(screen!.target).toMatchObject({ component: 'FeedScreen', path: ['FeedScreen'], file: 'app/src/features/feed/FeedScreen.tsx' });
    expect(screen!.target.text).toBeUndefined();
  });

  it('cuts a long text to 160 characters', () => {
    const s = scene();
    under(s.post);
    const [post] = pickAt(240, 200);
    expect(post!.target.component).toBe('FeedPost');
    expect(post!.target.text).toHaveLength(160);
    expect(post!.target.text!.endsWith('…')).toBe(true);
  });

  it('skips components that are not the app\'s, and looks through memo and forwardRef', () => {
    const s = scene();
    under(s.input);
    const levels = pickAt(100, 380);
    const names = levels.flatMap((level) => level.target.path ?? []);
    // Pressable, View and SceneView are in the tree and in nobody's ancestry.
    expect(names).not.toContain('Pressable');
    expect(names).not.toContain('SceneView');
    // forwardRef(TextField) and memo(FeedPostItem) are named by what they wrap.
    expect(levels.map((level) => level.target.component)).toEqual(['TextField', 'TextField', 'FeedScreen']);
    under(s.score);
    expect(pickAt(420, 100)[0]!.target.path).toContain('FeedPostItem');
  });

  it('reads a display name, and sees through one that only decorates the function name', () => {
    const element = host('div', { rect: [0, 0, 100, 100], text: LONG_TEXT });
    // What Expo Router does to a route's component in development.
    const routed = Object.assign(named('FeedScreen'), { displayName: 'FeedScreen(./(tabs)/feed/index.tsx)' });
    const renamed = Object.assign(named('t'), { displayName: 'Header' });
    mount(component(routed, {}, [host('div', { rect: [0, 0, 200, 200] }, [component(renamed, {}, [element])])]), document.body);
    under(element);
    expect(pickAt(1, 1).map((level) => level.target.component)).toEqual(['Header', 'FeedScreen']);
  });

  it('names a labelled part of a component after the component: TabBar › Add Bev', () => {
    const s = scene();
    under(s.svg, s.tabIcon, s.addBev, s.nav, s.root);
    const levels = pickAt(240, 710);
    // The Icon and TabIcon inside the tab have nothing to name them and are left out.
    expect(levels.map((level) => level.title)).toEqual(['TabBar › Add Bev', 'TabBar · Main', 'RootLayout › TabsLayout']);
    expect(levels[0]!.target).toMatchObject({
      component: 'TabBar',
      path: ['RootLayout', 'TabsLayout', 'TabBar'],
      file: 'app/src/components/TabBar.tsx',
      label: 'Add Bev',
      role: 'button',
      rect: { x: 192, y: 690, width: 96, height: 78 },
    });
    // The part is an element, not a component: it carries no props. The component does.
    expect(levels[0]!.target.props).toBeUndefined();
    expect(levels[1]!.target).toMatchObject({ component: 'TabBar', label: 'Main', role: 'navigation', props: { active: 'feed', safeArea: true } });
  });

  it('leaves out a component with no label and no text inside a labelled control', () => {
    const s = scene();
    under(s.image, s.row);
    expect(pickAt(40, 100).map((level) => level.title)).toEqual(['BevRow · Coca-Cola, 8.2', 'FeedPostItem › FeedPost', 'FeedScreen']);
  });

  it('skips the reporter\'s own UI', () => {
    const s = scene();
    const overlay = document.createElement('div');
    overlay.setAttribute(REPORT_UI_ATTR, 'true');
    const drop = overlay.appendChild(document.createElement('span'));
    document.body.appendChild(overlay);
    document.elementsFromPoint = jest.fn(() => [drop, overlay, el(s.score), el(s.row)]);
    expect(pickAt(420, 100)[0]!.title).toBe('ScoreBubble · 8.2');
    document.elementsFromPoint = jest.fn(() => [drop, overlay]);
    expect(pickAt(420, 100)).toEqual([]);
  });

  it('looks past something laid over the page from outside React', () => {
    const s = scene();
    const foreign = document.body.appendChild(document.createElement('div'));
    document.elementsFromPoint = jest.fn(() => [foreign, el(s.score), el(s.row)]);
    expect(pickAt(420, 100)[0]!.title).toBe('ScoreBubble · 8.2');
    expect(pickScreen()!.title).toBe('FeedScreen');
  });

  it('collapses a level drawn exactly where the one inside it is, keeping the inner name', () => {
    const s = scene();
    under(s.post);
    const components = pickAt(240, 200).map((level) => level.target.component);
    // FeedPostItem wraps FeedPost at the same box (within a pixel); RootLayout wraps TabsLayout.
    expect(components).toEqual(['FeedPost', 'FeedScreen']);
    under(s.nav);
    expect(pickAt(10, 710).map((level) => level.target.component)).toEqual(['TabBar', 'TabsLayout']);
  });

  it('keeps the screen even when a component fills it', () => {
    const inner = host('div', { rect: [0, 0, 480, 700], text: LONG_TEXT });
    const outer = host('div', { rect: [0, 0.4, 480, 700] }, [component(named('Header'), {}, [inner])]);
    mount(component(named('FeedScreen'), {}, [outer]), document.body);
    under(inner);
    expect(pickAt(10, 10).map((level) => level.target.component)).toEqual(['Header', 'FeedScreen']);
  });

  it('drops a level with no area, and clips a box to the viewport', () => {
    const tall = host('div', { rect: [0, 600, 480, 400], text: 'Below the fold' });
    const empty = host('div', { rect: [0, 0, 0, 0] }, [component(named('Header'), {}, [tall])]);
    const offscreen = host('div', { rect: [0, 900, 480, 100] });
    const screen = host('div', { rect: [0, 0, 480, 768] }, [component(named('Spacer'), {}, [empty]), component(named('Icon'), {}, [offscreen])]);
    mount(component(named('FeedScreen'), {}, [screen]), document.body);
    under(tall);
    const levels = pickAt(10, 700);
    // Spacer's own element has no box, so it is looked through to the same element Header draws.
    expect(levels.map((level) => level.target.component)).toEqual(['Header', 'FeedScreen']);
    expect(levels[0]!.box).toEqual({ x: 0, y: 600, width: 480, height: 168 });
    under(offscreen);
    expect(pickAt(10, 760).map((level) => level.target.component)).toEqual(['FeedScreen']);
  });

  it('keeps only scalar props, and never a handler, a style, children or what someone typed', () => {
    const s = scene();
    under(s.header);
    const [header] = pickAt(10, 10);
    expect(header!.target.props).toEqual({
      title: 'Feed',
      count: 3,
      large: true,
      justFits: 'y'.repeat(80),
    });
  });

  it('keeps at most 12 props', () => {
    const element = host('div', { rect: [0, 0, 100, 100] });
    const props = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, i]));
    mount(component(named('Header'), props, [element]), document.body);
    under(element);
    expect(Object.keys(pickAt(1, 1)[0]!.target.props!)).toHaveLength(12);
  });

  it('prints styles as design tokens, and says so when a value has none', () => {
    const s = scene();
    under(s.header);
    expect(pickAt(10, 10)[0]!.target.styles).toEqual({
      backgroundColor: 'colors.primary',
      color: 'colors.onPrimary',
      fontSize: 'type.screenTitle',
      borderRadius: '13px (no token)',
      padding: 'spacing.md',
      opacity: '0.5',
    });
    under(s.score);
    expect(pickAt(420, 100)[0]!.target.styles).toEqual({
      backgroundColor: '#010203 (no token)',
      color: 'colors.onPrimary',
      fontSize: '14px (no token)',
      fontWeight: '600',
      paddingVertical: 'spacing.xs',
      paddingHorizontal: '13px (no token)',
    });
    under(s.nav);
    expect(pickAt(10, 710)[0]!.target.styles).toEqual({
      backgroundColor: 'colors.surface',
      borderColor: 'colors.border',
      borderWidth: '1px 0px 0px 0px',
    });
  });

  it('matches a dark-scheme colour, a translucent token, a radius and a gap', () => {
    const element = host('div', {
      rect: [0, 0, 100, 100],
      style: {
        'background-color': 'rgba(0, 0, 0, 0.65)',
        'border-top-left-radius': '999px',
        'border-top-right-radius': '999px',
        'border-bottom-right-radius': '999px',
        'border-bottom-left-radius': '999px',
        'row-gap': '8px',
        'column-gap': '8px',
      },
    });
    const label = host('span', { rect: [0, 0, 50, 20], text: 'Caption', style: { color: 'rgb(185, 164, 242)', 'font-size': '13px', 'font-weight': '400' } });
    el(element).appendChild(el(label));
    mount(component(named('Header'), {}, [element]), document.body);
    under(element);
    expect(pickAt(1, 1)[0]!.target.styles).toEqual({
      // #000000a6: `photoScrim` in the light scheme, which is tried first; rgb(185, 164, 242) is dark's `primary`.
      backgroundColor: 'colors.photoScrim',
      color: 'colors.primary',
      fontSize: 'type.caption',
      borderRadius: 'radius.pill',
      gap: 'spacing.sm',
    });
  });

  it('never reads what was typed into a field', () => {
    const s = scene();
    under(s.input);
    const levels = pickAt(100, 380);
    expect(levels[0]!.title).toBe('TextField › Search Bevs');
    expect(levels[0]!.target).toMatchObject({ component: 'TextField', label: 'Search Bevs', role: 'textbox' });
    expect(levels[0]!.target.text).toBeUndefined();
    expect(levels[1]!.target.props).toEqual({ label: 'Search' });
    expect(JSON.stringify(levels)).not.toContain('secret');
  });

  it('takes the file of a neighbour for a name two files define', () => {
    const element = host('div', { rect: [0, 0, 100, 100] });
    mount(component(named('RankFlow'), {}, [host('div', { rect: [0, 0, 200, 200] }, [component(named('Screen'), {}, [element])])]), document.body);
    under(element);
    expect(pickAt(1, 1)[0]!.target).toMatchObject({ component: 'Screen', file: 'app/src/features/ranking/RankFlow.tsx' });

    document.body.innerHTML = '';
    const alone = host('div', { rect: [0, 0, 100, 100] });
    mount(component(named('Screen'), {}, [alone]), document.body);
    under(alone);
    expect(pickAt(1, 1)[0]!.target.file).toBe('app/src/features/onboarding/starter/StarterStep.tsx');
  });

  it('reads props from the current copy of a fiber, not the one the element happens to point at', () => {
    const element = host('div', { rect: [0, 0, 100, 100] });
    const stale = component(named('Header'), { title: 'Old' }, [element]);
    const current: FakeFiber = { ...stale, memoizedProps: { title: 'New' }, alternate: stale };
    stale.alternate = current;
    const rootFiber: FakeFiber = { type: null, return: null, child: current, sibling: null, stateNode: null, memoizedProps: null };
    rootFiber.stateNode = { current: rootFiber };
    current.return = rootFiber;
    stale.return = rootFiber;
    // The element's fiber still returns to the stale copy.
    element.return = stale;
    mount(element, document.body);
    under(element);
    expect(pickAt(1, 1)[0]!.target.props).toEqual({ title: 'New' });
  });

  it('keeps titles under 60 characters', () => {
    const element = host('div', { rect: [0, 0, 100, 100], attrs: { 'aria-label': 'A label that goes on and on and on, well past what a highlight can show' } });
    mount(component(named('Header'), {}, [element]), document.body);
    under(element);
    const [level] = pickAt(1, 1);
    expect(level!.title.length).toBeLessThan(60);
    expect(level!.title.startsWith('Header · A label that goes on')).toBe(true);
    expect(level!.target.label).toBe('A label that goes on and on and on, well past what a highlight can show');
  });

  it('caps the levels at 8 and keeps the screen as the last one', () => {
    let inner: FakeFiber = host('div', { rect: [0, 0, 10, 10], text: 'x' });
    const leaf = inner;
    for (let i = 1; i <= 12; i++) inner = host('div', { rect: [0, 0, 10 + i * 10, 10 + i * 10] }, [component(named(i % 2 ? 'Header' : 'Icon'), { depth: i }, [inner])]);
    mount(component(named('FeedScreen'), {}, [inner]), document.body);
    under(leaf);
    const levels = pickAt(1, 1);
    expect(levels).toHaveLength(8);
    expect(levels[0]!.target.props).toEqual({ depth: 1 });
    expect(levels[7]!.target.component).toBe('FeedScreen');
    expect(levels[0]!.target.path!.length).toBeLessThanOrEqual(8);
  });

  it('never throws: no fiber, nothing under the point, a broken fiber', () => {
    const plain = document.body.appendChild(document.createElement('div'));
    document.elementsFromPoint = jest.fn(() => [plain]);
    expect(pickAt(1, 1)).toEqual([]);
    document.elementsFromPoint = jest.fn(() => []);
    expect(pickAt(1, 1)).toEqual([]);
    document.elementsFromPoint = jest.fn(() => {
      throw new Error('no layout');
    });
    expect(pickAt(1, 1)).toEqual([]);

    const broken = document.body.appendChild(document.createElement('div'));
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('React changed');
        },
      },
    );
    (broken as unknown as Record<string, unknown>).__reactFiber$test = trap;
    document.elementsFromPoint = jest.fn(() => [broken]);
    expect(pickAt(1, 1)).toEqual([]);
    expect(pickScreen()).toBeNull();
    expect(tapTitle(broken, 1, 1)).toBeUndefined();

    // A text node, null, a detached element.
    expect(tapTitle(null, 1, 1)).toBeUndefined();
    expect(tapTitle(document.createElement('div'), 1, 1)).toBeUndefined();
  });

  it('finds the nearest element React rendered when the one under the point is not its own', () => {
    const s = scene();
    const foreign = el(s.score).appendChild(document.createElement('b'));
    document.elementsFromPoint = jest.fn(() => [foreign]);
    expect(pickAt(420, 100)[0]!.title).toBe('ScoreBubble · 8.2');
  });
});

describe('pickScreen', () => {
  it('is the route\'s screen component, with the app column as its box', () => {
    const s = scene();
    under(s.post, s.screen, s.root);
    const level = pickScreen();
    expect(document.elementsFromPoint).toHaveBeenCalledWith(240, 384);
    expect(level).toMatchObject({
      title: 'FeedScreen',
      box: { x: 0, y: 0, width: 480, height: 768 },
      target: {
        component: 'FeedScreen',
        path: ['FeedScreen'],
        file: 'app/src/features/feed/FeedScreen.tsx',
        rect: { x: 0, y: 0, width: 480, height: 768 },
      },
    });
    expect(level!.target.text).toBeUndefined();
    expect(columnBox()).toEqual({ x: 0, y: 0, width: 480, height: 768 });
  });

  it('is null when nothing React rendered is on show', () => {
    document.body.appendChild(document.createElement('div')).id = 'root';
    expect(pickScreen()).toBeNull();
  });
});

describe('tapTitle', () => {
  it('names the control that took the tap, not what is drawn inside it', () => {
    const s = scene();
    expect(tapTitle(el(s.score), 420, 100)).toBe('BevRow · Coca-Cola, 8.2');
    expect(tapTitle(el(s.svg), 240, 710)).toBe('TabBar › Add Bev');
  });

  it('names what is under the tap when it is not a control', () => {
    const s = scene();
    expect(tapTitle(el(s.header), 10, 10)).toBe('Header · Feed');
  });

  it('names a field by its component and label, never by its contents', () => {
    const s = scene();
    expect(tapTitle(el(s.input), 100, 380)).toBe('TextField › Search Bevs');
  });

  it('ignores a tap on the reporter\'s own UI', () => {
    const s = scene();
    const overlay = document.body.appendChild(document.createElement('div'));
    overlay.setAttribute(REPORT_UI_ATTR, 'true');
    const button = overlay.appendChild(document.createElement('button'));
    under(s.score);
    expect(tapTitle(button, 420, 100)).toBeUndefined();
  });

  it('falls back to the point when the event has no target', () => {
    const s = scene();
    under(s.score);
    expect(tapTitle(null, 420, 100)).toBe('BevRow · Coca-Cola, 8.2');
  });
});
