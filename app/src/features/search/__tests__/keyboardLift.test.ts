import { keyboardInsetFrom } from '@/lib/useKeyboardInset';

import { footLift, keyboardTop } from '../keyboardLift';

// An iPhone home-screen app: an 852pt layout viewport, the keyboard leaving a 476pt visual
// viewport, and the panel ending above the 83pt tab bar.
const INNER_HEIGHT = 852;
const PANEL_BOTTOM = 852 - 83;

it('raises the foot by the part of the keyboard taller than what lies under the panel', () => {
  const inset = keyboardInsetFrom(INNER_HEIGHT, { height: 476, offsetTop: 0, scale: 1 });
  expect(inset).toBe(376);
  const top = keyboardTop(INNER_HEIGHT, inset);
  expect(top).toBe(476);
  expect(footLift(PANEL_BOTTOM, top)).toBe(293);
});

it('measures from the layout viewport, not the shrunk visual viewport (which would count the keyboard twice)', () => {
  const inset = keyboardInsetFrom(INNER_HEIGHT, { height: 476, offsetTop: 0, scale: 1 });
  // What react-native-web's useWindowDimensions reports with the keyboard open.
  const visualHeight = 476;
  expect(footLift(PANEL_BOTTOM, keyboardTop(visualHeight, inset))).toBe(669);
  expect(footLift(PANEL_BOTTOM, keyboardTop(INNER_HEIGHT, inset))).toBe(293);
});

it('a page panned by the keyboard (offsetTop) still lands the foot on the keyboard', () => {
  const vv = { height: 476, offsetTop: 120, scale: 1 };
  const top = keyboardTop(INNER_HEIGHT, keyboardInsetFrom(INNER_HEIGHT, vv));
  expect(top).toBe(vv.offsetTop + vv.height);
});

it('no lift with the keyboard closed, or when the keyboard is shorter than the tab bar', () => {
  expect(footLift(PANEL_BOTTOM, keyboardTop(INNER_HEIGHT, 0))).toBe(0);
  expect(footLift(PANEL_BOTTOM, keyboardTop(INNER_HEIGHT, 60))).toBe(0);
});
