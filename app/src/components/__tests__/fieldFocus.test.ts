import { focusRegisteredField, registerField } from '../fieldFocus';

it('focuses the field registered under an id, and nothing once it is gone', () => {
  const focus = jest.fn();
  const unregister = registerField('a', focus);
  expect(focusRegisteredField('a')).toBe(true);
  expect(focus).toHaveBeenCalledTimes(1);
  unregister();
  expect(focusRegisteredField('a')).toBe(false);
  expect(focus).toHaveBeenCalledTimes(1);
});

it("a field that unmounts after another took its id does not remove the newer one", () => {
  const first = jest.fn();
  const second = jest.fn();
  const unregisterFirst = registerField('b', first);
  const unregisterSecond = registerField('b', second);
  unregisterFirst();
  expect(focusRegisteredField('b')).toBe(true);
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  unregisterSecond();
});
