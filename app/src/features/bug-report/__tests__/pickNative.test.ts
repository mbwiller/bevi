import { colors, radius, spacing } from '@/theme/tokens';

import { fiberOfTarget, levelsForTarget, setMeasureForTests, titleForTarget } from '../pickNative';
import type { Fiber } from '../pickCore';
import type { Box } from '../types';

// Picking on iOS, against React's own data structures: there is no renderer under jest to ask, so
// the trees here are built by hand in the shape React Native's renderer gives them (a host fiber's
// type is its native component's name and its instance is shared by its two copies; a string in a
// Text is a fiber of tag 6), and the measure is a table of boxes.

interface TestFiber extends Fiber {
  tag?: number;
}

/** Links children under a parent as React does: first child, then siblings, each pointing back. */
function link(parent: TestFiber, children: TestFiber[]): TestFiber {
  parent.child = children[0] ?? null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] ?? null;
  });
  return parent;
}

const boxes = new Map<object, Box>();

/** A host fiber ('RCTView', 'RCTText', a text field) with the box it would measure to. */
function host(type: string, props: Record<string, unknown>, box: Box | null, children: TestFiber[] = []): TestFiber {
  const instance = { node: {} };
  if (box) boxes.set(instance, box);
  return link({ type, memoizedProps: props, stateNode: instance }, children);
}

/** A string inside a Text. */
const str = (value: string): TestFiber => ({ tag: 6, type: null, memoizedProps: value, stateNode: {} });

function named(name: string): () => null {
  const component = (): null => null;
  Object.defineProperty(component, 'name', { value: name });
  return component;
}

/** An app component (a function with that name) around its children. */
function comp(name: string, props: Record<string, unknown>, children: TestFiber[]): TestFiber {
  return link({ type: named(name), memoizedProps: props, stateNode: null }, children);
}

/** Puts a tree under a root as React keeps it, and returns the tree. */
function mount(tree: TestFiber): TestFiber {
  const root: TestFiber = { type: null, stateNode: null };
  root.stateNode = { current: root };
  link(root, [tree]);
  return tree;
}

const b = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

beforeEach(() => {
  boxes.clear();
  setMeasureForTests((element) => boxes.get(element) ?? null);
});

afterAll(() => setMeasureForTests(null));

/** A feed post as the app draws it: a screen, a post, a pressable image with a label, and a caption. */
function feed() {
  const image = host('ViewManagerAdapter_ExpoImage', { accessibilityLabel: 'Photo of Cold Brew Black' }, b(16, 200, 112, 112));
  const caption = host('RCTText', { style: { fontSize: 15, fontWeight: '400', color: colors.light.text } }, b(140, 200, 240, 44), [str('a lot yummier than I thought')]);
  const bevImage = comp('BevImage', { size: 112, variant: 'card' }, [
    host('RCTView', { accessibilityLabel: 'Open Cold Brew Black', accessibilityRole: 'button', onStartShouldSetResponder: () => true }, b(16, 200, 112, 112), [image]),
  ]);
  const post = comp('FeedPost', { postId: 'not-read' }, [
    host('RCTView', { style: { padding: spacing.md, backgroundColor: colors.light.surface } }, b(0, 180, 402, 220), [bevImage, caption]),
  ]);
  mount(comp('FeedScreen', {}, [host('RCTView', {}, b(0, 0, 402, 874), [post])]));
  return { image, caption };
}

describe('what a touch landed on', () => {
  it('names the component, its file, its label and its box, innermost first, up to the screen', () => {
    const { image } = feed();
    const levels = levelsForTarget({ __internalInstanceHandle: image });

    expect(levels.map((level) => level.title)).toEqual(['BevImage · Open Cold Brew Black', 'FeedScreen › FeedPost', 'FeedScreen']);
    const first = levels[0]!;
    expect(first.target).toMatchObject({
      component: 'BevImage',
      file: 'app/src/components/BevImage.tsx',
      label: 'Open Cold Brew Black',
      role: 'button',
      path: ['FeedScreen', 'FeedPost', 'BevImage'],
      props: { size: 112, variant: 'card' },
      rect: { x: 16, y: 200, width: 112, height: 112 },
    });
    expect(first.box).toEqual(b(16, 200, 112, 112));
  });

  it("reads a component's text from the Texts under it, and never a prop that is not about how it is drawn", () => {
    const { caption } = feed();
    const post = levelsForTarget(caption).find((level) => level.target.component === 'FeedPost')!;
    expect(post.target.text).toBe('a lot yummier than I thought');
    expect(post.target.props).toBeUndefined();
  });

  it('says how a component was drawn in token names', () => {
    const { caption } = feed();
    const post = levelsForTarget(caption).find((level) => level.target.component === 'FeedPost')!;
    expect(post.target.styles).toMatchObject({ backgroundColor: 'colors.surface', padding: 'spacing.md', color: 'colors.text', fontSize: 'type.body' });
  });

  it('reads a style given as a list, and says when a value is no token', () => {
    const pill = comp('Pill', {}, [
      host('RCTView', { style: [{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.light.borderStrong }, { paddingHorizontal: 7 }] }, b(10, 10, 80, 30), [
        host('RCTText', {}, b(20, 15, 60, 20), [str('Try again')]),
      ]),
    ]);
    mount(comp('FeedScreen', {}, [host('RCTView', {}, b(0, 0, 402, 874), [pill])]));
    const level = levelsForTarget(pill.child!)[0]!;
    expect(level.title).toBe('Pill · Try again');
    expect(level.target.styles).toMatchObject({ borderRadius: 'radius.pill', borderWidth: '1px', borderColor: 'colors.borderStrong', paddingHorizontal: '7px (no token)' });
  });

  it("never reads what was typed: a field is named by its placeholder, and its contents are nobody's text", () => {
    const input = host('RCTSinglelineTextInputView', { placeholder: 'Name', value: 'my secret', text: 'my secret' }, b(16, 100, 370, 44), [str('my secret')]);
    const field = comp('TextField', { label: 'Name', value: 'my secret' }, [host('RCTView', {}, b(16, 80, 370, 64), [input])]);
    mount(comp('FeedScreen', {}, [host('RCTView', {}, b(0, 0, 402, 874), [field])]));

    const levels = levelsForTarget(input);
    expect(JSON.stringify(levels)).not.toContain('my secret');
    expect(levels[0]!.title).toBe('TextField › Name');
    expect(levels[0]!.target.role).toBe('textbox');
  });

  it('leaves out what is not displayed', () => {
    const hidden = host('RCTView', { style: { display: 'none' } }, b(0, 0, 100, 20), [host('RCTText', {}, b(0, 0, 100, 20), [str('Hidden tab')])]);
    const shown = host('RCTText', {}, b(0, 30, 100, 20), [str('Shown')]);
    const post = comp('FeedPost', {}, [host('RCTView', {}, b(0, 0, 402, 100), [hidden, shown])]);
    mount(comp('FeedScreen', {}, [host('RCTView', {}, b(0, 0, 402, 874), [post])]));
    expect(levelsForTarget(shown)[0]!.target.text).toBe('Shown');
  });
});

describe('what a tap is called in the steps', () => {
  it('is the control that took it, not the text inside it', () => {
    const label = host('RCTText', {}, b(280, 500, 80, 20), [str('Loved it')]);
    const button = comp('BucketButton', { bucket: 'LOVED' }, [
      host('RCTView', { accessibilityLabel: 'Loved it', accessibilityRole: 'button', onClick: () => {} }, b(265, 483, 121, 116), [label]),
    ]);
    mount(comp('FeedScreen', {}, [host('RCTView', {}, b(0, 0, 402, 874), [button])]));
    expect(titleForTarget({ __internalInstanceHandle: label })).toBe('BucketButton · Loved it');
  });
});

describe('a target that cannot be read', () => {
  it('finds the fiber behind the view a touch event names, or a fiber itself, and nothing else', () => {
    const view = host('RCTView', {}, b(0, 0, 10, 10));
    expect(fiberOfTarget({ __internalInstanceHandle: view })).toBe(view);
    expect(fiberOfTarget(view)).toBe(view);
    for (const target of [null, undefined, 7, 'view', {}, { __internalInstanceHandle: 3 }]) expect(fiberOfTarget(target)).toBeNull();
  });

  it('answers nothing, and never throws', () => {
    expect(levelsForTarget(null)).toEqual([]);
    expect(levelsForTarget(12)).toEqual([]);
    expect(titleForTarget({})).toBeUndefined();
    // A view React Native's own components drew, with no app component above it.
    expect(levelsForTarget(mount(host('RCTView', {}, b(0, 0, 10, 10))))).toEqual([]);
    // A measure that throws costs the box, not the app.
    setMeasureForTests(() => {
      throw new Error('no renderer');
    });
    const { image } = feed();
    expect(levelsForTarget(image)).toEqual([]);
  });
});
