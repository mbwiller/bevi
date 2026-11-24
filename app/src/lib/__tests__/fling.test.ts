import { DECELERATION, nearest, project, restAfter, RUBBER, SETTLE, settle } from '../fling';

describe('project', () => {
  it('is how far a release would coast: a list flicked at that speed stops there', () => {
    expect(project(0)).toBe(0);
    // 1000 pt/s at UIScrollView's normal rate coasts 499pt (WWDC 2018, "Designing Fluid Interfaces").
    expect(project(1000)).toBeCloseTo(499, 5);
    expect(project(-1000)).toBeCloseTo(-499, 5);
    expect(DECELERATION).toBe(0.998);
  });
});

describe('nearest', () => {
  it('picks the closest rest point', () => {
    expect(nearest(10, [0, 300, 800])).toBe(0);
    expect(nearest(149, [0, 300, 800])).toBe(0);
    expect(nearest(151, [0, 300, 800])).toBe(300);
    expect(nearest(2000, [0, 300, 800])).toBe(800);
    expect(nearest(-50, [0, 300, 800])).toBe(0);
  });
});

describe('restAfter', () => {
  const points = [0, 300, 800];

  it('with no speed, settles on the nearest point', () => {
    expect(restAfter(100, 0, points)).toBe(0);
    expect(restAfter(200, 0, points)).toBe(300);
  });

  it('a quick flick goes further than where the finger lifted', () => {
    // Lifted 40pt down from the top, but going fast: past the middle point to the last.
    expect(restAfter(40, 1500, points)).toBe(800);
    // The same lift, slower: the middle point.
    expect(restAfter(40, 500, points)).toBe(300);
  });

  it('a flick back the other way is a change of mind', () => {
    expect(restAfter(500, -1500, points)).toBe(0);
  });
});

describe('settle', () => {
  it('is the settle spring carrying on at the release speed', () => {
    expect(settle(1200)).toEqual({ ...SETTLE, velocity: 1200 });
  });

  it('does not wobble: the spring is at least critically damped', () => {
    expect(SETTLE.damping).toBeGreaterThanOrEqual(2 * Math.sqrt(SETTLE.stiffness * SETTLE.mass));
  });

  it('gives a little past the end', () => {
    expect(RUBBER).toBeGreaterThan(0);
    expect(RUBBER).toBeLessThan(0.5);
  });
});
