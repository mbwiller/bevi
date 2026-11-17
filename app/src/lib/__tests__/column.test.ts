import { COLUMN_MAX_WIDTH, columnWidth, isWideViewport } from '../column';

describe('the centred column', () => {
  it('is 480pt wide', () => {
    expect(COLUMN_MAX_WIDTH).toBe(480);
  });

  it.each([
    [1440, 900],
    [768, 1024],
    [1024, 768],
    [481, 481],
  ])('applies to a %ix%i window, whose screens get 480pt', (width, height) => {
    expect(isWideViewport({ width, height })).toBe(true);
    expect(columnWidth({ width, height })).toBe(480);
  });

  it.each([
    [393, 852],
    [320, 568],
    [440, 956],
    // Phones in landscape: wider than the column, but never taller than it.
    [852, 393],
    [956, 440],
    [480, 900],
  ])('never applies to a %ix%i phone, whose screens keep the window width', (width, height) => {
    expect(isWideViewport({ width, height })).toBe(false);
    expect(columnWidth({ width, height })).toBe(width);
  });
});
