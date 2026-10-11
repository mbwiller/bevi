import { fade, mix, shade } from '../color';

it('mixes, fades and shades like CSS color-mix', () => {
  expect(mix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  expect(mix('#1c7f46', '#ffffff', 0.12)).toBe('#e4f0e9');
  expect(fade('#ffffffcc', 0.5)).toBe('#ffffff66');
  expect(fade('#1c7f46', 0.7)).toBe('#1c7f46b3');
  expect(shade('#ffffff', 0.5)).toBe('#808080');
});
