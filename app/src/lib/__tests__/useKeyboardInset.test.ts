import { keyboardInsetFrom } from '../useKeyboardInset';

it('is what the visual viewport leaves uncovered at the bottom of the layout viewport', () => {
  // iPhone, keyboard closed.
  expect(keyboardInsetFrom(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
  // Keyboard open (336pt): the visual viewport shrinks.
  expect(keyboardInsetFrom(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  // Safari panned the page up 100pt to reveal the focused field: only the rest is still covered.
  expect(keyboardInsetFrom(844, { height: 508, offsetTop: 100, scale: 1 })).toBe(236);
});

it('is 0 while pinch-zoomed, and never negative', () => {
  expect(keyboardInsetFrom(844, { height: 422, offsetTop: 0, scale: 2 })).toBe(0);
  expect(keyboardInsetFrom(844, { height: 844, offsetTop: 10, scale: 1 })).toBe(0);
});
