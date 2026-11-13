// Turning what the image model returns into the asset the app stores.
//
// The model gives back an opaque illustration on a flat near-white field. Three
// things have to happen to it, and all three were settled by the 2026-11-11
// spike (plan §4) rather than guessed:
//
//   1. MATTE it, so the icon is transparent like every authored one. Measured:
//      the authored PNGs run 62-82% fully transparent pixels, and this
//      produces ~68% on the spike's output.
//   2. COMPOSITE OUR OWN GROUND SHADOW, because the model is told not to draw
//      one. A generated shadow cannot be matted -- see `matte` below -- and
//      drawing it ourselves means a generated icon carries byte-identical
//      shadow geometry to all 192 authored ones.
//   3. FIND THE LABEL BAND, so the app can draw the drink's name across it.
//      The lettering is NOT generated: the model's output filter rejects a
//      recognisable brand mark outright (error 3030, deterministic), which is
//      why the prompt forbids lettering and the wordmark is added afterwards
//      from what the user typed.
//
// Everything here is pure: buffers in, buffers out, no I/O and no clock. That
// is what makes it testable, and this is where the visual quality lives.

import type { Raster } from './png.ts';

// --------------------------------------------------------------------------
// Matte
// --------------------------------------------------------------------------

export interface MatteOptions {
  /**
   * How far from the background colour a pixel may sit and still be treated as
   * background, as a sum of absolute RGB differences.
   *
   * 85 is not arbitrary: the spike measured the rendered bottle body at ~94
   * from the rendered white in that metric, so this has to stay clear of it.
   * Widening it far enough to swallow a drawn shadow would eat the product,
   * which is the whole reason the model is told not to draw one.
   */
  tolerance?: number;
  /**
   * Below this distance a pixel is fully transparent. The model's "flat white"
   * is not uniform -- the spike saw (253,253,255) in one corner and
   * (254,255,250) elsewhere -- so without a dead zone the background mattes to
   * alpha ~24 instead of 0 and the icon carries a faint haze.
   */
  noise?: number;
}

/**
 * Alpha from the background, by flood fill from the border.
 *
 * Flood fill rather than a global colour key, because a key keyed on white
 * would punch holes through a white bottle cap or a pale label. Only pixels
 * CONNECTED to the border are background; an enclosed white region is product.
 *
 * Opacity ramps with distance rather than switching at a threshold, so an
 * anti-aliased edge feathers instead of showing stair-steps.
 *
 * Deliberately NOT handled: a soft drop shadow. Its dark core is not
 * border-connected, so a fill stops at its edge and leaves an opaque grey
 * ellipse -- plainly visible against the app's `#121214` dark surface. No
 * tolerance fixes that (see `tolerance` above). The pipeline avoids the
 * problem instead: the prompt forbids a shadow and `compositeShadow` adds the
 * real one.
 */
export function matte(src: Raster, options: MatteOptions = {}): Raster {
  const tolerance = options.tolerance ?? 85;
  const noise = options.noise ?? 14;
  const { width, height, data } = src;
  const out = new Uint8Array(data);

  const seedR = data[0];
  const seedG = data[1];
  const seedB = data[2];
  const distance = (i: number) =>
    Math.abs(data[i] - seedR) + Math.abs(data[i + 1] - seedG) + Math.abs(data[i + 2] - seedB);

  const reached = new Uint8Array(width * height);
  // An explicit stack, not recursion: a 768x1024 field would blow the call
  // stack long before it ran out of work.
  const stack = new Int32Array(width * height);
  let top = 0;

  const push = (x: number, y: number) => {
    const p = y * width + x;
    if (reached[p]) return;
    if (distance(p * 4) > tolerance) return;
    reached[p] = 1;
    stack[top++] = p;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  const span = tolerance - noise;
  for (let p = 0; p < width * height; p++) {
    if (!reached[p]) continue;
    const d = distance(p * 4);
    out[p * 4 + 3] = d <= noise ? 0 : Math.min(255, Math.round((255 * (d - noise)) / span));
  }

  return { width, height, data: out };
}

/** Share of fully transparent pixels. The authored icons measure 0.62-0.82. */
export function transparentFraction(raster: Raster): number {
  let clear = 0;
  for (let p = 0; p < raster.width * raster.height; p++) {
    if (raster.data[p * 4 + 3] === 0) clear++;
  }
  return clear / (raster.width * raster.height);
}

// --------------------------------------------------------------------------
// The ground shadow
// --------------------------------------------------------------------------

/**
 * `scripts/icons/style.mjs` draws every authored icon's shadow as
 *
 *   <ellipse cx="100" cy="239" rx="58" ry="11"/>
 *
 * on a 200x260 canvas, filled with a radial gradient from `#3c372d` at 0.18
 * opacity to the same colour at 0. These are those numbers, normalised, so the
 * two pipelines cannot drift apart.
 */
export const SHADOW = {
  cx: 100 / 200,
  cy: 239 / 260,
  rx: 58 / 200,
  ry: 11 / 260,
  color: { r: 0x3c, g: 0x37, b: 0x2d },
  opacity: 0.18,
} as const;

/** Composites the authored shadow primitive UNDER the artwork, in place. */
export function compositeShadow(raster: Raster): Raster {
  const { width, height, data } = raster;
  const out = new Uint8Array(data);
  const cx = SHADOW.cx * width;
  const cy = SHADOW.cy * height;
  const rx = SHADOW.rx * width;
  const ry = SHADOW.ry * height;

  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const t = Math.sqrt(nx * nx + ny * ny);
      if (t >= 1) continue;
      // The SVG's radial gradient: full opacity at the centre, zero at the rim.
      const shadowAlpha = SHADOW.opacity * (1 - t) * 255;
      const p = (y * width + x) * 4;
      const over = out[p + 3];
      // `source-over` with the shadow BEHIND: the artwork keeps its own alpha
      // and colour, and the shadow only fills what the artwork leaves clear.
      const add = (shadowAlpha * (255 - over)) / 255;
      const total = over + add;
      if (total <= 0) continue;
      out[p] = Math.round((out[p] * over + SHADOW.color.r * add) / total);
      out[p + 1] = Math.round((out[p + 1] * over + SHADOW.color.g * add) / total);
      out[p + 2] = Math.round((out[p + 2] * over + SHADOW.color.b * add) / total);
      out[p + 3] = Math.round(Math.min(255, total));
    }
  }
  return { width, height, data: out };
}

// --------------------------------------------------------------------------
// The label band
// --------------------------------------------------------------------------

export interface LabelBand {
  /** All normalised 0-1 against the icon, so they survive any resize. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Mean colour of the band, for choosing readable text against it. */
  color: { r: number; g: number; b: number };
  /** True when the band is dark enough that white type reads on it. */
  dark: boolean;
}

function saturationValue(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return [max === 0 ? 0 : (max - min) / max, max / 255];
}

/**
 * Finds the drink's label: the widest run of rows dominated by one strongly
 * saturated colour.
 *
 * Returns null when there is no such band, which is the right answer for a
 * cafe latte or a homemade smoothie -- those have no wordmark, and the app
 * then draws none. Detection rather than fixed geometry because the band sits
 * wherever the drink's own label sits.
 */
export function findLabelBand(raster: Raster, minSaturation = 0.35): LabelBand | null {
  const { width, height, data } = raster;
  const counts = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let n = 0;
    // Every third column: the band is hundreds of pixels wide, and this is a
    // third of the work for the same answer.
    for (let x = 0; x < width; x += 3) {
      const p = (y * width + x) * 4;
      if (data[p + 3] < 200) continue;
      const [s, v] = saturationValue(data[p], data[p + 1], data[p + 2]);
      if (s > minSaturation && v > 0.2) n++;
    }
    counts[y] = n;
  }

  let peak = 0;
  for (let y = 0; y < height; y++) peak = Math.max(peak, counts[y]);
  if (peak === 0) return null;

  const threshold = peak * 0.5;
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    if (counts[y] >= threshold) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  if (y0 < 0 || y1 - y0 < height * 0.04) return null; // too thin to letter

  const mid = (y0 + y1) >> 1;
  let x0 = -1;
  let x1 = -1;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 0; x < width; x++) {
    const p = (mid * width + x) * 4;
    if (data[p + 3] < 200) continue;
    const [s, v] = saturationValue(data[p], data[p + 1], data[p + 2]);
    if (s > minSaturation && v > 0.2) {
      if (x0 < 0) x0 = x;
      x1 = x;
      r += data[p];
      g += data[p + 1];
      b += data[p + 2];
      n++;
    }
  }
  if (x0 < 0 || n === 0 || x1 - x0 < width * 0.15) return null;

  const color = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  // Rec. 601 luma: the usual "is this dark enough for white text" test.
  const luma = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
  return {
    x: x0 / width,
    y: y0 / height,
    width: (x1 - x0) / width,
    height: (y1 - y0) / height,
    color,
    dark: luma < 0.6,
  };
}

// --------------------------------------------------------------------------
// Resize
// --------------------------------------------------------------------------

/**
 * Box-filter downscale. Only ever used to shrink (1024 -> 256), where
 * averaging the source pixels that fall inside each destination pixel is both
 * correct and cheap; it is not a general resampler.
 */
export function downscale(src: Raster, targetWidth: number, targetHeight: number): Raster {
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const xRatio = src.width / targetWidth;
  const yRatio = src.height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < src.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.width; sx++) {
          const p = (sy * src.width + sx) * 4;
          const alpha = src.data[p + 3];
          // Premultiplied, so a transparent pixel's colour cannot bleed into
          // the average and fringe the edges.
          r += src.data[p] * alpha;
          g += src.data[p + 1] * alpha;
          b += src.data[p + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const d = (y * targetWidth + x) * 4;
      if (a === 0 || n === 0) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
      } else {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(a / n);
      }
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}
