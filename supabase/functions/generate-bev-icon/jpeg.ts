// A baseline JPEG decoder, in pure TypeScript with no imports.
//
// WHY THIS EXISTS
// ---------------
// `flux-2-klein-9b` returns **JPEG**, always. Its Cloudflare schema says only
// "Generated image as Base64 string" and names no format; the bytes are JFIF
// every time, and neither `output_format=png` nor `response_format=png`
// changes that (tested 2026-11-11, three configurations, baseline included).
// So the worker has to open a JPEG before it can matte anything.
//
// Deno cannot do it for us. `createImageBitmap` does decode the JPEG, but
// `OffscreenCanvas.getContext('2d')` returns null -- there is no 2D backend --
// so the pixels are unreachable. And `supabase/functions/*/deno.json` keeps an
// empty import map on purpose, so that CI's `deno check` resolves nothing off
// the network. That leaves writing it.
//
// SCOPE: baseline sequential DCT, 8-bit, Huffman, 1 or 3 components, any
// common chroma subsampling, with restart intervals. That is exactly what the
// model emits ("baseline, precision 8, components 3"). Progressive and
// arithmetic-coded JPEGs throw by name rather than decoding to noise.
//
// Verified against Pillow's decoder on real model output: see `test.ts`.

import type { Raster } from './png.ts';

const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

interface HuffTable {
  /** code length -> smallest code of that length */
  minCode: Int32Array;
  maxCode: Int32Array;
  /** code length -> index into `values` of its first code */
  valPtr: Int32Array;
  values: Uint8Array;
}

function buildHuffTable(counts: Uint8Array, values: Uint8Array): HuffTable {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17).fill(-1);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    valPtr[length] = k;
    minCode[length] = code;
    code += counts[length - 1];
    k += counts[length - 1];
    // A table claiming more codes of this length than the code space holds is
    // malformed. Unchecked, `decodeHuff` indexes past `values`, gets
    // `undefined`, and the decode degrades into a plausible grey image that
    // could be PUBLISHED as somebody's icon. Better to refuse the file.
    if (code > 1 << length) throw new Error(`malformed Huffman table: ${code} codes of length ${length}`);
    maxCode[length] = counts[length - 1] > 0 ? code - 1 : -1;
    code <<= 1;
  }
  if (k > values.length) {
    throw new Error(`malformed Huffman table: ${k} codes but ${values.length} values`);
  }
  return { minCode, maxCode, valPtr, values };
}

interface Component {
  id: number;
  h: number;
  v: number;
  quantId: number;
  dcTable: number;
  acTable: number;
  pred: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  /** Decoded samples, one byte per pixel, at this component's own resolution. */
  samples: Uint8ClampedArray;
}

/**
 * The AAN-style separable inverse DCT the reference decoder uses, in integer
 * arithmetic. Straightforward rather than clever: this runs 8x8 at a time over
 * a 768x1024 frame and still costs well under a tenth of a second.
 */
function idctBlock(coeffs: Int32Array, out: Uint8ClampedArray, outOffset: number, outStride: number): void {
  const tmp = new Float32Array(64);

  // Rows.
  for (let i = 0; i < 8; i++) {
    const o = i * 8;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        const cu = u === 0 ? Math.SQRT1_2 : 1;
        sum += cu * coeffs[o + u] * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      }
      tmp[o + x] = sum / 2;
    }
  }
  // Columns.
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? Math.SQRT1_2 : 1;
        sum += cv * tmp[v * 8 + x] * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      }
      out[outOffset + y * outStride + x] = sum / 2 + 128;
    }
  }
}

/**
 * @param maxEdge Largest frame edge worth decoding.
 *
 * Without it, SOF's width and height are whatever the file claims, and
 * `decodeScan` allocates `blocksPerLine*8 * blocksPerColumn*8` bytes per
 * component from them: a 40-byte header declaring 65535x65535 asks for ~4.3 GB
 * and then grinds through 67 million MCUs, each running an 8x8 IDCT. Typed
 * array backing store sits outside the old-space heap, so a heap limit does
 * not save the isolate either. The caller also asserts the decoded size is the
 * size it asked for, so this is the inner of two guards.
 */
export function decodeJpeg(bytes: Uint8Array, maxEdge = 8192): Raster {
  if (bytes.length < 4) throw new Error('not a JPEG');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');

  const quantTables: (Int32Array | null)[] = [null, null, null, null];
  const dcTables: (HuffTable | null)[] = [];
  const acTables: (HuffTable | null)[] = [];
  let frameWidth = 0;
  let frameHeight = 0;
  let components: Component[] = [];
  let maxH = 1;
  let maxV = 1;
  let restartInterval = 0;
  let progressive = false;

  let offset = 2;
  const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      continue;
    }
    const length = u16(offset);
    const segment = offset + 2;
    const segmentEnd = offset + length;

    switch (marker) {
      case 0xdb: { // DQT
        let at = segment;
        while (at < segmentEnd) {
          const precision = bytes[at] >> 4;
          const id = bytes[at] & 15;
          at++;
          if (at + (precision ? 128 : 64) > bytes.length) {
            throw new Error('truncated JPEG quantisation table');
          }
          const table = new Int32Array(64);
          for (let i = 0; i < 64; i++) {
            table[ZIGZAG[i]] = precision ? u16(at + i * 2) : bytes[at + i];
          }
          at += precision ? 128 : 64;
          quantTables[id] = table;
        }
        break;
      }
      case 0xc0:
      case 0xc1:
      case 0xc2: { // SOF0 / SOF1 baseline, SOF2 progressive
        if (marker === 0xc2) progressive = true;
        frameHeight = u16(segment + 1);
        frameWidth = u16(segment + 3);
        if (frameWidth <= 0 || frameHeight <= 0) {
          throw new Error(`JPEG frame has no area (${frameWidth}x${frameHeight})`);
        }
        if (frameWidth > maxEdge || frameHeight > maxEdge) {
          throw new Error(`JPEG frame too large (${frameWidth}x${frameHeight}, max ${maxEdge})`);
        }
        const count = bytes[segment + 5];
        if (count !== 1 && count !== 3) throw new Error(`unsupported JPEG component count ${count}`);
        if (segment + 6 + count * 3 > bytes.length) throw new Error('truncated JPEG frame header');
        components = [];
        for (let i = 0; i < count; i++) {
          const at = segment + 6 + i * 3;
          const h = bytes[at + 1] >> 4;
          const v = bytes[at + 1] & 15;
          if (h < 1 || v < 1 || h > 4 || v > 4) {
            throw new Error(`unsupported JPEG sampling factors ${h}x${v}`);
          }
          maxH = Math.max(maxH, h);
          maxV = Math.max(maxV, v);
          components.push({
            id: bytes[at], h, v, quantId: bytes[at + 2],
            dcTable: 0, acTable: 0, pred: 0,
            blocksPerLine: 0, blocksPerColumn: 0,
            samples: new Uint8ClampedArray(0),
          });
        }
        break;
      }
      case 0xc4: { // DHT
        let at = segment;
        while (at < segmentEnd) {
          const cls = bytes[at] >> 4;
          const id = bytes[at] & 15;
          at++;
          const counts = bytes.subarray(at, at + 16);
          at += 16;
          let total = 0;
          for (let i = 0; i < 16; i++) total += counts[i];
          if (at + total > bytes.length) throw new Error('truncated JPEG Huffman table');
          const values = bytes.subarray(at, at + total);
          at += total;
          const table = buildHuffTable(counts, values);
          if (cls === 0) dcTables[id] = table;
          else acTables[id] = table;
        }
        break;
      }
      case 0xdd: // DRI
        restartInterval = u16(segment);
        break;
      case 0xda: { // SOS
        if (progressive) throw new Error('progressive JPEG is not supported');
        const count = bytes[segment];
        for (let i = 0; i < count; i++) {
          const id = bytes[segment + 1 + i * 2];
          const tables = bytes[segment + 2 + i * 2];
          const component = components.find((c) => c.id === id);
          if (!component) throw new Error(`scan names unknown component ${id}`);
          component.dcTable = tables >> 4;
          component.acTable = tables & 15;
        }
        offset = decodeScan(segmentEnd);
        continue;
      }
      default:
        break;
    }
    offset = segmentEnd;
  }

  if (!frameWidth || !frameHeight || components.length === 0) throw new Error('JPEG has no frame');
  return toRaster();

  // ------------------------------------------------------------------------

  function decodeScan(start: number): number {
    const mcusPerLine = Math.ceil(frameWidth / (8 * maxH));
    const mcusPerColumn = Math.ceil(frameHeight / (8 * maxV));

    for (const c of components) {
      c.blocksPerLine = mcusPerLine * c.h;
      c.blocksPerColumn = mcusPerColumn * c.v;
      c.samples = new Uint8ClampedArray(c.blocksPerLine * 8 * c.blocksPerColumn * 8);
      c.pred = 0;
    }

    let at = start;
    let bitBuffer = 0;
    let bitCount = 0;

    function readBit(): number {
      if (bitCount === 0) {
        if (at >= bytes.length) return 0;
        let byte = bytes[at++];
        if (byte === 0xff) {
          const next = bytes[at];
          if (next === 0x00) at++;            // stuffed byte
          else if (next >= 0xd0 && next <= 0xd7) { at++; byte = bytes[at++]; }
          else return 0;                       // a real marker: scan is over
        }
        bitBuffer = byte;
        bitCount = 8;
      }
      bitCount--;
      return (bitBuffer >> bitCount) & 1;
    }

    function decodeHuff(table: HuffTable): number {
      let code = 0;
      for (let length = 1; length <= 16; length++) {
        code = (code << 1) | readBit();
        if (table.maxCode[length] >= 0 && code <= table.maxCode[length]) {
          const index = table.valPtr[length] + code - table.minCode[length];
          const value = table.values[index];
          if (value === undefined) throw new Error('corrupt JPEG: Huffman code out of range');
          return value;
        }
      }
      throw new Error('corrupt JPEG: no Huffman code matched');
    }

    function receiveExtend(size: number): number {
      if (size === 0) return 0;
      let value = 0;
      for (let i = 0; i < size; i++) value = (value << 1) | readBit();
      // Negative values are stored as the ones' complement, spec F.2.2.1.
      return value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
    }

    const block = new Int32Array(64);
    let mcu = 0;
    const totalMcus = mcusPerLine * mcusPerColumn;

    while (mcu < totalMcus) {
      if (restartInterval && mcu > 0 && mcu % restartInterval === 0) {
        bitCount = 0;
        for (const c of components) c.pred = 0;
        // Step over the RSTn marker if the encoder emitted one here.
        while (at < bytes.length - 1 && !(bytes[at] === 0xff && bytes[at + 1] >= 0xd0 && bytes[at + 1] <= 0xd7)) at++;
        if (at < bytes.length - 1) at += 2;
      }

      const mcuRow = (mcu / mcusPerLine) | 0;
      const mcuCol = mcu % mcusPerLine;

      for (const c of components) {
        const quant = quantTables[c.quantId];
        if (!quant) throw new Error(`missing quantisation table ${c.quantId}`);
        for (let v = 0; v < c.v; v++) {
          for (let h = 0; h < c.h; h++) {
            block.fill(0);
            const dcTable = dcTables[c.dcTable];
            const acTable = acTables[c.acTable];
            if (!dcTable || !acTable) throw new Error('missing Huffman table');

            const t = decodeHuff(dcTable);
            c.pred += receiveExtend(t);
            block[0] = c.pred * quant[0];

            let k = 1;
            while (k < 64) {
              const rs = decodeHuff(acTable);
              const size = rs & 15;
              const run = rs >> 4;
              if (size === 0) {
                if (run !== 15) break; // EOB
                k += 16;
                continue;
              }
              k += run;
              if (k > 63) break;
              block[ZIGZAG[k]] = receiveExtend(size) * quant[ZIGZAG[k]];
              k++;
            }

            const blockRow = mcuRow * c.v + v;
            const blockCol = mcuCol * c.h + h;
            const stride = c.blocksPerLine * 8;
            idctBlock(block, c.samples, blockRow * 8 * stride + blockCol * 8, stride);
          }
        }
      }
      mcu++;
    }

    // Hand back the position of the next marker.
    while (at < bytes.length - 1 && !(bytes[at] === 0xff && bytes[at + 1] !== 0x00 && !(bytes[at + 1] >= 0xd0 && bytes[at + 1] <= 0xd7))) at++;
    return at;
  }

  function toRaster(): Raster {
    const out = new Uint8Array(frameWidth * frameHeight * 4);
    const planes = components.map((c) => ({
      samples: c.samples,
      stride: c.blocksPerLine * 8,
      // Nearest-neighbour chroma upsampling. The artwork is flat-shaded and
      // the result is immediately matted and downscaled, so a bilinear
      // upsample would cost CPU for a difference nothing can see.
      scaleX: c.h / maxH,
      scaleY: c.v / maxV,
    }));

    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const d = (y * frameWidth + x) * 4;
        if (planes.length === 1) {
          const p = planes[0];
          const value = p.samples[((y * p.scaleY) | 0) * p.stride + ((x * p.scaleX) | 0)];
          out[d] = out[d + 1] = out[d + 2] = value;
        } else {
          const [yp, cbp, crp] = planes;
          const Y = yp.samples[((y * yp.scaleY) | 0) * yp.stride + ((x * yp.scaleX) | 0)];
          const Cb = cbp.samples[((y * cbp.scaleY) | 0) * cbp.stride + ((x * cbp.scaleX) | 0)] - 128;
          const Cr = crp.samples[((y * crp.scaleY) | 0) * crp.stride + ((x * crp.scaleX) | 0)] - 128;
          // JFIF YCbCr -> RGB, spec E.
          out[d] = clamp(Y + 1.402 * Cr);
          out[d + 1] = clamp(Y - 0.344136 * Cb - 0.714136 * Cr);
          out[d + 2] = clamp(Y + 1.772 * Cb);
        }
        out[d + 3] = 255;
      }
    }
    return { width: frameWidth, height: frameHeight, data: out };
  }
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}
