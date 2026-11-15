// Tests for the icon worker's image pipeline.
//
//   deno test --allow-net --allow-env supabase/functions/generate-bev-icon/
//
// No network and no provider: every case below is a synthetic raster built in
// the test, because the point is to pin the behaviour the 2026-11-11 spike
// established, not to re-run the spike. The numbers that look oddly specific
// (62-82% transparency, a bottle ~94 from white, shadow at cy=239/260) all
// come from measurements recorded in plan §4 and in `image.ts`.

import { decodePng, encodePng, type Raster } from './png.ts';
import { decodeJpeg } from './jpeg.ts';
import { ICON_BUCKET, iconUploadUrl } from './index.ts';
import {
  compositeShadow,
  downscale,
  findLabelBand,
  matte,
  SHADOW,
  transparentFraction,
} from './image.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function blank(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = rgba[0];
    data[p * 4 + 1] = rgba[1];
    data[p * 4 + 2] = rgba[2];
    data[p * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}

function fillRect(
  raster: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * raster.width + x) * 4;
      raster.data[p] = rgba[0];
      raster.data[p + 1] = rgba[1];
      raster.data[p + 2] = rgba[2];
      raster.data[p + 3] = rgba[3];
    }
  }
}

/**
 * A stand-in for what the model returns: a pale "bottle" on the non-uniform
 * near-white the spike actually measured, with a saturated blue label band and
 * an enclosed white cap. The cap is the interesting part -- a global colour key
 * would delete it, and a flood fill must not.
 */
function syntheticBottle(): Raster {
  const r = blank(120, 200, [253, 253, 255, 255]);
  // Background noise, exactly the variation the spike saw between corners.
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 120; x++) {
      if ((x + y) % 7 === 0) {
        const p = (y * 120 + x) * 4;
        r.data[p] = 254;
        r.data[p + 1] = 255;
        r.data[p + 2] = 250;
      }
    }
  }
  fillRect(r, 40, 30, 80, 180, [233, 232, 202, 255]); // body, ~94 from white in L1
  // The cap, as the model actually renders one: white, but shaded. A FLAT pure
  // white cap would be indistinguishable from the background it touches -- see
  // the "cannot separate" test below, which pins that limit deliberately.
  fillRect(r, 52, 14, 68, 30, [255, 255, 255, 255]);
  fillRect(r, 50, 14, 52, 30, [198, 198, 196, 255]);  // left shading
  fillRect(r, 68, 14, 70, 30, [198, 198, 196, 255]);  // right shading
  fillRect(r, 52, 12, 70, 14, [210, 210, 208, 255]);  // top rim
  fillRect(r, 40, 70, 80, 120, [40, 80, 190, 255]);   // label band, saturated blue
  return r;
}

// --------------------------------------------------------------------------
// png.ts
// --------------------------------------------------------------------------

Deno.test('png: round-trips a raster through encode and decode', async () => {
  const src = syntheticBottle();
  const decoded = await decodePng(await encodePng(src));
  assertEquals(decoded.width, src.width, 'width');
  assertEquals(decoded.height, src.height, 'height');
  for (let i = 0; i < src.data.length; i++) {
    if (decoded.data[i] !== src.data[i]) {
      throw new Error(`byte ${i} differs: ${decoded.data[i]} vs ${src.data[i]}`);
    }
  }
});

Deno.test('png: preserves alpha exactly, which is the whole point of the asset', async () => {
  const src = blank(8, 8, [10, 20, 30, 0]);
  fillRect(src, 2, 2, 6, 6, [10, 20, 30, 128]);
  const decoded = await decodePng(await encodePng(src));
  assertEquals(decoded.data[3], 0, 'corner stays fully transparent');
  assertEquals(decoded.data[(3 * 8 + 3) * 4 + 3], 128, 'middle keeps partial alpha');
});

Deno.test('png: refuses what it cannot decode rather than returning garbage', async () => {
  let threw = false;
  try {
    await decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  } catch (error) {
    threw = true;
    assert(String(error).includes('not a PNG'), 'names the problem');
  }
  assert(threw, 'a non-PNG must throw');
});

// --------------------------------------------------------------------------
// matte
// --------------------------------------------------------------------------

Deno.test('matte: clears the background and lands in the authored transparency band', () => {
  const out = matte(syntheticBottle());
  assertEquals(out.data[3], 0, 'corner is fully transparent');
  const fraction = transparentFraction(out);
  assert(
    fraction > 0.5 && fraction < 0.9,
    `transparency ${fraction.toFixed(2)} should sit near the authored 0.62-0.82 band`,
  );
});

Deno.test('matte: keeps a white cap, which a global colour key would delete', () => {
  const out = matte(syntheticBottle());
  // Dead centre of the cap: pure white, but walled off from the background by
  // its own shading, so the fill cannot reach it.
  const capAlpha = out.data[(20 * 120 + 60) * 4 + 3];
  assertEquals(capAlpha, 255, 'a shaded white cap is product, not background');
});

Deno.test('matte: CANNOT separate product that is exactly the background colour', () => {
  // A documented limit, not a bug to fix later: if a region is both the
  // background's colour AND connected to it, nothing distinguishes them. The
  // pipeline avoids it by asking the model for a shaded render rather than
  // flat fills -- every real output the spike produced had shaded edges.
  const flat = blank(60, 80, [253, 253, 255, 255]);
  fillRect(flat, 20, 10, 40, 70, [255, 255, 255, 255]); // flat white "product"
  const out = matte(flat);
  assertEquals(
    out.data[(40 * 60 + 30) * 4 + 3],
    0,
    'flat white on near-white mattes away entirely -- known and accepted',
  );
});

Deno.test('matte: keeps the product body, which sits only ~94 from the background', () => {
  const out = matte(syntheticBottle());
  const bodyAlpha = out.data[(150 * 120 + 60) * 4 + 3];
  assertEquals(bodyAlpha, 255, 'a pale body must stay opaque at the default tolerance of 85');
});

Deno.test('matte: a background dead zone stops the faint haze a noisy white causes', () => {
  // Without `noise`, the (254,255,250) speckle mattes to alpha ~24, not 0.
  const out = matte(syntheticBottle());
  let hazy = 0;
  for (let x = 0; x < 120; x++) {
    if (out.data[(2 * 120 + x) * 4 + 3] !== 0) hazy++;
  }
  assertEquals(hazy, 0, 'every background pixel in a clear row is fully transparent');
});

Deno.test('matte: does not overflow the stack on a full-size frame', () => {
  // 768x1024 is the production size; recursion would die here.
  const out = matte(blank(768, 1024, [255, 255, 255, 255]));
  assertEquals(transparentFraction(out), 1, 'an empty frame mattes away entirely');
});

// --------------------------------------------------------------------------
// shadow
// --------------------------------------------------------------------------

Deno.test('shadow: matches style.mjs geometry, so generated and authored icons agree', () => {
  assertEquals(SHADOW.cx, 100 / 200, 'cx');
  assertEquals(SHADOW.cy, 239 / 260, 'cy');
  assertEquals(SHADOW.rx, 58 / 200, 'rx');
  assertEquals(SHADOW.ry, 11 / 260, 'ry');
  assertEquals(SHADOW.opacity, 0.18, 'opacity');
});

Deno.test('shadow: lands under the product and leaves the rest clear', () => {
  const src = blank(200, 260, [0, 0, 0, 0]);
  const out = compositeShadow(src);
  const centre = out.data[((239 * 200) + 100) * 4 + 3];
  assert(centre > 0, 'the shadow centre is visible');
  assert(centre < 60, `the shadow stays soft (alpha ${centre}, 0.18 opacity)`);
  assertEquals(out.data[(10 * 200 + 10) * 4 + 3], 0, 'the top-left corner stays clear');
  assertEquals(out.data[(239 * 200 + 5) * 4 + 3], 0, 'outside the ellipse stays clear');
});

Deno.test('shadow: never dims artwork already standing on the spot', () => {
  const src = blank(200, 260, [0, 0, 0, 0]);
  fillRect(src, 90, 230, 110, 250, [255, 0, 0, 255]);
  const out = compositeShadow(src);
  const p = ((239 * 200) + 100) * 4;
  assertEquals(out.data[p + 3], 255, 'opaque artwork stays opaque');
  assertEquals(out.data[p], 255, 'and keeps its own colour: the shadow is behind it');
});

// --------------------------------------------------------------------------
// label band
// --------------------------------------------------------------------------

Deno.test('label band: finds the saturated band and reads white type onto it', () => {
  const band = findLabelBand(matte(syntheticBottle()));
  assert(band, 'the blue band is found');
  assert(band.y > 0.3 && band.y < 0.4, `band starts near y=70/200, got ${band.y.toFixed(2)}`);
  assert(band.height > 0.2 && band.height < 0.3, `band is ~50/200 tall, got ${band.height.toFixed(2)}`);
  assert(band.dark, 'a saturated blue takes white lettering');
  assert(band.color.b > band.color.r, 'the mean colour is blue');
});

Deno.test('label band: a drink with no label gets none, so the app letters nothing', () => {
  // A cafe latte or a smoothie: no saturated band anywhere.
  const plain = blank(120, 200, [253, 253, 255, 255]);
  fillRect(plain, 40, 30, 80, 180, [233, 232, 202, 255]);
  assertEquals(findLabelBand(matte(plain)), null, 'no band, no lettering');
});

Deno.test('label band: a band too narrow to letter is rejected', () => {
  const narrow = blank(120, 200, [253, 253, 255, 255]);
  fillRect(narrow, 40, 30, 80, 180, [233, 232, 202, 255]);
  fillRect(narrow, 58, 70, 62, 120, [40, 80, 190, 255]); // 4px wide
  assertEquals(findLabelBand(matte(narrow)), null, 'too narrow for a wordmark');
});

// --------------------------------------------------------------------------
// downscale
// --------------------------------------------------------------------------

Deno.test('downscale: halves a raster and keeps flat colour exact', () => {
  const src = blank(64, 64, [10, 150, 200, 255]);
  const out = downscale(src, 32, 32);
  assertEquals(out.width, 32, 'width');
  assertEquals(out.height, 32, 'height');
  const p = (16 * 32 + 16) * 4;
  assertEquals(out.data[p], 10, 'r');
  assertEquals(out.data[p + 1], 150, 'g');
  assertEquals(out.data[p + 2], 200, 'b');
  assertEquals(out.data[p + 3], 255, 'a');
});

Deno.test('downscale: a transparent pixel cannot bleed colour into its neighbours', () => {
  // Half opaque red, half fully transparent *green*. Averaging without
  // premultiplying would drag green into the red half and fringe the edge.
  const src = blank(4, 2, [255, 0, 0, 255]);
  fillRect(src, 2, 0, 4, 2, [0, 255, 0, 0]);
  const out = downscale(src, 2, 1);
  assertEquals(out.data[0], 255, 'the surviving colour is pure red');
  assertEquals(out.data[1], 0, 'no green bled in');
  assertEquals(out.data[3], 255, 'the red half stays opaque');
  assertEquals(out.data[7], 0, 'the transparent half stays transparent');
});

// --------------------------------------------------------------------------
// end to end
// --------------------------------------------------------------------------

Deno.test('pipeline: model output -> matted, shadowed, lettered-ready, two sizes', async () => {
  const fromModel = await encodePng(syntheticBottle());

  const decoded = await decodePng(fromModel);
  const cut = matte(decoded);
  const band = findLabelBand(cut);
  const finished = compositeShadow(cut);
  const small = downscale(finished, 30, 50);

  assert(band, 'the band survives to the app');
  assertEquals(finished.data[3], 0, 'the finished icon is transparent at the corner');
  assert(transparentFraction(finished) > 0.5, 'and transparent over most of the frame');
  assertEquals(small.width, 30, 'the small size is produced from the same art');

  // Both sizes must survive a round trip, since both are stored.
  const big = await decodePng(await encodePng(finished));
  assertEquals(big.width, 120, 'the stored full size decodes');
  const thumb = await decodePng(await encodePng(small));
  assertEquals(thumb.width, 30, 'the stored thumbnail decodes');
});

// --------------------------------------------------------------------------
// Hostile input
// --------------------------------------------------------------------------
// Every case here is a defect a security review found in this decoder on
// 2026-11-11. The decoder parses bytes from a remote party while the worker
// holds the service-role key, so "degrades into something plausible" is the
// dangerous outcome, not a merciful one: a grey image passes the worker's
// transparency gate and gets PUBLISHED as somebody's icon.

/** A JPEG header with a forged SOF0 frame size. Nothing else need be valid. */
function forgedFrame(width: number, height: number, components = 3): Uint8Array {
  const out: number[] = [0xff, 0xd8];                 // SOI
  const body = [
    8,                                                 // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    components,
  ];
  for (let i = 0; i < components; i++) body.push(i + 1, 0x11, 0);
  const length = body.length + 2;
  out.push(0xff, 0xc0, (length >> 8) & 0xff, length & 0xff, ...body);
  return Uint8Array.from(out);
}

Deno.test('jpeg: refuses a frame larger than the cap instead of allocating it', () => {
  // 65535x65535 asks for ~4.3 GB of component samples and 67 million MCUs.
  let threw = '';
  try {
    decodeJpeg(forgedFrame(65535, 65535), 4096);
  } catch (error) {
    threw = String(error);
  }
  assert(threw.includes('too large'), `expected a size refusal, got: ${threw || 'no throw'}`);
});

Deno.test('jpeg: refuses a zero-area frame', () => {
  let threw = '';
  try {
    decodeJpeg(forgedFrame(0, 1024), 4096);
  } catch (error) {
    threw = String(error);
  }
  assert(threw.includes('no area'), `expected an area refusal, got: ${threw || 'no throw'}`);
});

Deno.test('jpeg: refuses impossible sampling factors rather than decoding black', () => {
  const bytes = forgedFrame(64, 64, 1);
  bytes[bytes.length - 2] = 0x00; // h = v = 0
  let threw = '';
  try {
    decodeJpeg(bytes, 4096);
  } catch (error) {
    threw = String(error);
  }
  assert(threw.includes('sampling factors'), `expected a sampling refusal, got: ${threw || 'no throw'}`);
});

Deno.test('jpeg: refuses a Huffman table that overruns the code space', () => {
  // 255 codes of length 1, where only 2 can exist. Unchecked this made
  // decodeHuff return undefined and the image decode to smooth grey.
  // The 255 value bytes ARE present, so this reaches the code-space check
  // rather than the truncation check -- both refuse, but this pins the one
  // that catches a well-formed-looking table that cannot exist.
  const out: number[] = [0xff, 0xd8];
  const body = [0x00, 255, ...new Array(15).fill(0), ...new Array(255).fill(0)];
  const length = body.length + 2;
  out.push(0xff, 0xc4, (length >> 8) & 0xff, length & 0xff, ...body);
  let threw = '';
  try {
    decodeJpeg(Uint8Array.from(out), 4096);
  } catch (error) {
    threw = String(error);
  }
  assert(threw.includes('malformed Huffman'), `expected a Huffman refusal, got: ${threw || 'no throw'}`);
});

Deno.test('jpeg: refuses a truncated file rather than reading past the buffer', () => {
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xff, 0xd8]), forgedFrame(64, 64).slice(0, 8)]) {
    let threw = false;
    try {
      decodeJpeg(bytes, 4096);
    } catch {
      threw = true;
    }
    assert(threw, `a ${bytes.length}-byte input must throw, not decode`);
  }
});

// --------------------------------------------------------------------------
// Storage object keys
// --------------------------------------------------------------------------
// `create_bev` proves the object exists and belongs to the caller, but not
// that its key is a sane shape. WHATWG URL parsing resolves `..` BEFORE the
// request is sent, so a raw interpolation turned a storage read into an
// arbitrary service-role GET against the project, with the body forwarded to
// the image provider. Verified against Deno's own Request.

const SAFE_OBJECT_KEY = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/i;
function safeObjectPath(key: string): string | null {
  if (!SAFE_OBJECT_KEY.test(key)) return null;
  const parts = key.split('/');
  if (parts.some((part) => part === '.' || part === '..')) return null;
  return parts.map(encodeURIComponent).join('/');
}

Deno.test('object keys: traversal is rejected, and would otherwise escape the bucket', () => {
  const uid = '00000000-0000-4000-8000-00000000fa01';
  const hostile = [
    `${uid}/../../../rest/v1/profiles`,
    '../../../../auth/v1/admin/users',
    `${uid}/%2e%2e/%2e%2e/rest/v1/profiles`,
    `${uid}/photo.jpg?select=*`,
    `${uid}/a/b.jpg`,
  ];
  for (const key of hostile) {
    assertEquals(safeObjectPath(key), null, `must reject: ${key}`);
  }
  // And this is what made it dangerous: the URL escapes the prefix entirely.
  const escaped = new Request(`https://p.supabase.co/storage/v1/object/bev-photos/${hostile[1]}`).url;
  assertEquals(escaped, 'https://p.supabase.co/auth/v1/admin/users', 'traversal really does escape');
});

Deno.test('object keys: the shape media.upload actually builds is accepted', () => {
  const key = '00000000-0000-4000-8000-00000000fa01/9f8e7d6c-1234.jpg';
  assertEquals(safeObjectPath(key), key, 'a normal upload path passes through unchanged');
});

// --------------------------------------------------------------------------
// The upload target
// --------------------------------------------------------------------------
// This exists because the bucket rename reached the migration and the reader
// but NOT the writer, and both suites stayed green: pgTAP cannot see
// TypeScript, and nothing asserted the URL. Every icon would have been
// refused on mime type and burned all five attempts, with the feature looking
// healthy. One assertion is the difference.

Deno.test('upload: the URL targets the generated-icon bucket, not the authored one', () => {
  assertEquals(ICON_BUCKET, 'bev-generated-icons', 'the bucket the migration creates');
  const url = iconUploadUrl('https://p.supabase.co', 'bev-1/icon-768.png');
  assertEquals(
    url,
    'https://p.supabase.co/storage/v1/object/bev-generated-icons/bev-1/icon-768.png',
    'the upload URL is built from ICON_BUCKET',
  );
  // `bev-icons` is main's authored-SVG bucket: image/svg+xml only, 512 KiB, so
  // a PNG posted there is refused and the job burns every attempt.
  assert(!url.includes('/object/bev-icons/'), 'never the authored-icon bucket');
});
