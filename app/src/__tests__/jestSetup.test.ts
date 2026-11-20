// What jest.setup.js must keep true for every suite, whatever the presets do.

it('performance.now does not record its calls', () => {
  // React Native's jest preset makes it `jest.fn(Date.now)`. React's development build calls it four
  // times per component per render, and a jest.fn keeps every call until it is cleared: that alone
  // took a route suite's heap past 3GB (jest.setup.js, jest.config.js).
  expect(jest.isMockFunction(performance.now)).toBe(false);
});

it('performance.now is still a clock in milliseconds', () => {
  const before = Date.now();
  const now = performance.now();
  expect(now).toBeGreaterThanOrEqual(before);
  expect(now).toBeLessThanOrEqual(Date.now());
});
