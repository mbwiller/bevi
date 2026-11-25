import { fittedSize, isOnImage, maxOffset } from '../zoom';

describe('image viewer zoom', () => {
  const box = { width: 300, height: 600 };

  it('fits an image the way contentFit="contain" does', () => {
    expect(fittedSize(box, { width: 1000, height: 1000 })).toEqual({ width: 300, height: 300 });
    expect(fittedSize(box, null)).toEqual(box);
  });

  it('tells a tap on the image from a tap on the space around it', () => {
    const fitted = fittedSize(box, { width: 1000, height: 1000 });
    expect(isOnImage(0, 0, fitted, 1, 0, 0)).toBe(true);
    expect(isOnImage(0, 200, fitted, 1, 0, 0)).toBe(false);
    // Zoomed in, the same point is on the image.
    expect(isOnImage(0, 200, fitted, 2, 0, 0)).toBe(true);
  });

  it('lets a zoomed image pan only as far as its edges', () => {
    expect(maxOffset(300, 300, 1)).toBe(0);
    expect(maxOffset(300, 300, 2)).toBe(150);
  });
});
