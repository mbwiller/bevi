import { clampView, clampZoom, CROP_MAX_ZOOM, cropBase, cropFor } from '../photoCrop';

// The PhotoCropper's maths, the same as the design system's web reference (primitives.jsx).

const D = 361;
const centre = { zoom: 1, x: 0, y: 0 };

describe('cropFor', () => {
  it('matches the hand-worked example: 1600x1200 at zoom 1, centred, is the middle 1200 square', () => {
    expect(cropFor(centre, 1600, 1200, D)).toEqual({ x: 200, y: 0, size: 1200 });
  });

  it('gives the centre square of a square, a landscape and a portrait photo at zoom 1', () => {
    expect(cropFor(centre, 1000, 1000, D)).toEqual({ x: 0, y: 0, size: 1000 });
    expect(cropFor(centre, 2048, 1536, D)).toEqual({ x: 256, y: 0, size: 1536 });
    expect(cropFor(centre, 1536, 2048, D)).toEqual({ x: 0, y: 256, size: 1536 });
  });

  it('follows a moved view: the photo moved right shows more of its left', () => {
    // base = 361 / 1200; moving the photo 90.25pt right is 300px of the photo.
    const base = cropBase(1600, 1200, D);
    expect(base).toBeCloseTo(361 / 1200);
    expect(cropFor({ zoom: 1, x: 300 * base, y: 0 }, 1600, 1200, D)).toEqual({ x: 0, y: 0, size: 1200 });
    expect(cropFor({ zoom: 1, x: -150 * base, y: 0 }, 1600, 1200, D)).toEqual({ x: 350, y: 0, size: 1200 });
  });

  it('frames a quarter of the short side at zoom 4', () => {
    expect(cropFor({ zoom: CROP_MAX_ZOOM, x: 0, y: 0 }, 1600, 1200, D)).toEqual({ x: 650, y: 450, size: 300 });
    // Moved to the top-left corner as far as it goes.
    const far = clampView({ zoom: 4, x: 1e6, y: 1e6 }, 1600, 1200, D);
    expect(cropFor(far, 1600, 1200, D)).toEqual({ x: 0, y: 0, size: 300 });
  });

  it('clamps an out-of-range view before working out the square', () => {
    expect(cropFor({ zoom: 9, x: 0, y: 0 }, 1600, 1200, D)).toEqual(cropFor({ zoom: 4, x: 0, y: 0 }, 1600, 1200, D));
    expect(cropFor({ zoom: 0.2, x: -1e6, y: 1e6 }, 1600, 1200, D)).toEqual({ x: 400, y: 0, size: 1200 });
  });

  it('rounds to whole pixels and stays inside the photo', () => {
    for (const [w, h] of [
      [1601, 1199],
      [999, 1777],
      [2048, 1365],
      [7, 5],
    ] as const) {
      for (const zoom of [1, 1.37, 2.5, 3.999, 4]) {
        for (const at of [-1e6, -33.3, 0, 41.7, 1e6]) {
          const c = cropFor({ zoom, x: at, y: -at }, w, h, D);
          expect(Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.size)).toBe(true);
          expect(c.size).toBeGreaterThanOrEqual(1);
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.size).toBeLessThanOrEqual(w);
          expect(c.y + c.size).toBeLessThanOrEqual(h);
        }
      }
    }
  });
});

describe('clampView', () => {
  it('keeps the zoom between 1 and CROP_MAX_ZOOM', () => {
    expect(CROP_MAX_ZOOM).toBe(4);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(10)).toBe(4);
    expect(clampView({ zoom: 0, x: 0, y: 0 }, 1600, 1200, D).zoom).toBe(1);
    expect(clampView({ zoom: 6, x: 0, y: 0 }, 1600, 1200, D).zoom).toBe(4);
  });

  it('keeps each axis so the photo covers the circle', () => {
    // 1600x1200 at zoom 1 is 481.33 x 361pt: it can move 60.17pt sideways and not at all up or down.
    const v = clampView({ zoom: 1, x: 500, y: -500 }, 1600, 1200, D);
    expect(v.x).toBeCloseTo((1600 * (D / 1200) - D) / 2);
    expect(v.y).toBe(0);
    expect(clampView({ zoom: 1, x: -500, y: 0 }, 1600, 1200, D).x).toBeCloseTo(-(1600 * (D / 1200) - D) / 2);
    // At zoom 2 the short side can move half the circle each way.
    const z2 = clampView({ zoom: 2, x: 0, y: 1e3 }, 1600, 1200, D);
    expect(z2.y).toBeCloseTo(D / 2);
    // A view already inside is left alone.
    expect(clampView({ zoom: 2, x: 10, y: -10 }, 1600, 1200, D)).toEqual({ zoom: 2, x: 10, y: -10 });
  });

  it('has no base before the circle is measured', () => {
    expect(cropBase(1600, 1200, 0)).toBe(0);
    expect(cropBase(0, 0, D)).toBe(0);
  });
});
