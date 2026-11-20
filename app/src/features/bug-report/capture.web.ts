import { colors, radius, type ColorScheme } from '@/theme/tokens';

import { columnBox } from './pick';
import { REPORT_UI_ATTR, type Box, type CaptureMark, type Shot } from './types';

/**
 * A picture of the app as it is on screen now: the web file (capture.ts is the native one, a real
 * window screenshot).
 *
 * The browser gives a page no way to photograph itself, so the picture is redrawn from the DOM by
 * html2canvas-pro, which walks the document and paints each box, text run and image onto a canvas
 * with the 2D API. It was chosen over modern-screenshot because almost every report is filed from
 * an iPhone home-screen app, and modern-screenshot draws through an SVG `<foreignObject>`, which
 * is the path WebKit is least reliable on (images missing on the first draw, the canvas tainted).
 * The library is its own chunk, loaded by the `import()` below on the first capture.
 *
 * What the redraw does not reproduce: `backdrop-filter` (a glass surface comes out as its
 * translucent fill), and anything drawn by another origin without CORS (the map can come out
 * blank). Images are asked for with CORS and one that is refused is left out, so the canvas is
 * never tainted and encoding cannot throw for that reason.
 */

const DEFAULT_TIMEOUT_MS = 4000;
/** The long side of the picture, in pixels. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/** The marks, in CSS px before scaling. */
const OUTLINE = 2;
const HALO = 1;
const FILL_ALPHA = 0.08;
const BADGE_RADIUS = 11;
const BADGE_RING = 1.5;
const BADGE_FONT = 13;

interface Rendered {
  blob: Blob;
  width: number;
  height: number;
}

function scheme(): ColorScheme {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, r: number): void {
  const corner = Math.max(0, Math.min(r, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + corner, y);
  ctx.arcTo(x + width, y, x + width, y + height, corner);
  ctx.arcTo(x + width, y + height, x, y + height, corner);
  ctx.arcTo(x, y + height, x, y, corner);
  ctx.arcTo(x, y, x + width, y, corner);
  ctx.closePath();
}

/** Each mark as a tinted, outlined box with its number in a badge on the top-left corner. `k` is canvas px per CSS px. */
function drawMarks(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, marks: readonly CaptureMark[], column: Box, k: number): void {
  const palette = colors[scheme()];
  const line = OUTLINE * k;
  const badge = BADGE_RADIUS * k;

  for (const mark of marks) {
    const x = (mark.box.x - column.x) * k;
    const y = (mark.box.y - column.y) * k;
    const width = mark.box.width * k;
    const height = mark.box.height * k;
    if (!(width > 0 && height > 0) || x >= canvas.width || y >= canvas.height || x + width <= 0 || y + height <= 0) continue;

    ctx.save();
    // The outline sits just inside the box, so a mark on the screen's edge is not cut in half.
    roundedRect(ctx, x + line / 2, y + line / 2, Math.max(0, width - line), Math.max(0, height - line), radius.button * k);
    ctx.globalAlpha = FILL_ALPHA;
    ctx.fillStyle = palette.primary;
    ctx.fill();
    ctx.globalAlpha = 1;
    // A `surface` line under the outline, a little wider, so it still reads on a `primary` button.
    ctx.lineWidth = line + HALO * 2 * k;
    ctx.strokeStyle = palette.surface;
    ctx.stroke();
    ctx.lineWidth = line;
    ctx.strokeStyle = palette.primary;
    ctx.stroke();

    // The badge is centred on the corner, pulled inside the picture when the corner is at its edge.
    const reach = badge + BADGE_RING * k;
    const cx = Math.min(Math.max(x, reach), canvas.width - reach);
    const cy = Math.min(Math.max(y, reach), canvas.height - reach);
    ctx.beginPath();
    ctx.arc(cx, cy, reach, 0, Math.PI * 2);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, badge, 0, Math.PI * 2);
    ctx.fillStyle = palette.primary;
    ctx.fill();
    ctx.fillStyle = palette.onPrimary;
    ctx.font = `700 ${BADGE_FONT * k}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(mark.n), cx, cy + k * 0.5);
    ctx.restore();
  }
}

/**
 * The picture that is sent: the rasteriser's canvas copied onto a new one no bigger than MAX_SIDE
 * on its long side, with the marks on top. A new canvas, because the rasteriser leaves its own
 * scale and offset on the context it drew with, and a mark must not be drawn through those.
 */
function compose(drawn: HTMLCanvasElement, marks: readonly CaptureMark[], column: Box): HTMLCanvasElement | null {
  const ratio = Math.min(1, MAX_SIDE / Math.max(drawn.width, drawn.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(drawn.width * ratio));
  canvas.height = Math.max(1, Math.round(drawn.height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no transparency: anything the rasteriser left clear is the screen's own background.
  ctx.fillStyle = colors[scheme()].surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawn, 0, 0, canvas.width, canvas.height);
  drawMarks(ctx, canvas, marks, column, canvas.width / column.width);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
    } catch {
      // A tainted canvas throws here.
      resolve(null);
    }
  });
}

async function render(marks: readonly CaptureMark[], timeoutMs: number, signal: AbortSignal | undefined): Promise<Rendered | null> {
  const column = columnBox();
  if (!column) return null;

  const { default: html2canvas } = await import('html2canvas-pro');
  if (signal?.aborted) return null;

  // Rendered straight at the size it will be sent at: a phone's 3x backing store would be four
  // times the pixels, for a picture that is scaled down afterwards anyway.
  const scale = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(column.width, column.height));
  const drawn = await html2canvas(document.body, {
    // Sheets are portalled to <body>, outside #root, so the document is drawn and cut to the column.
    x: column.x,
    y: column.y,
    width: column.width,
    height: column.height,
    scale,
    backgroundColor: colors[scheme()].surface,
    useCORS: true,
    allowTaint: false,
    foreignObjectRendering: false,
    logging: false,
    // An image that is slow or refused is left out rather than holding the picture up.
    imageTimeout: Math.max(500, Math.min(2500, Math.round(timeoutMs / 2))),
    ignoreElements: (element) => element.hasAttribute(REPORT_UI_ATTR),
    ...(signal ? { signal } : null),
  });
  if (signal?.aborted || drawn.width === 0 || drawn.height === 0) return null;

  const canvas = compose(drawn, marks, column);
  if (!canvas) return null;
  const blob = await toJpeg(canvas);
  return blob && blob.size > 0 ? { blob, width: canvas.width, height: canvas.height } : null;
}

/**
 * Rasterises the app column as it is now, without anything inside `[data-report-ui]`, draws each
 * mark as a numbered outline, and returns a JPEG. Resolves null when it cannot (off the web, the
 * rasteriser fails, or `timeoutMs` passes; default 4000). Never rejects.
 */
export function captureScreen(marks: CaptureMark[], opts?: { timeoutMs?: number }): Promise<Shot | null> {
  return new Promise<Shot | null>((resolve) => {
    try {
      if (typeof document === 'undefined' || typeof window === 'undefined') {
        resolve(null);
        return;
      }
      const timeoutMs = typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let settled = false;
      const settle = (rendered: Rendered | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let shot: Shot | null = null;
        try {
          // The object URL is made only for a picture that is handed over, so a late one leaks nothing.
          if (rendered) {
            const uri = URL.createObjectURL(rendered.blob);
            shot = { file: rendered.blob, mimeType: 'image/jpeg', uri, width: rendered.width, height: rendered.height };
          }
        } catch {
          shot = null;
        }
        resolve(shot);
      };
      const timer = setTimeout(() => {
        settle(null);
        try {
          controller?.abort();
        } catch {
          // Nothing to stop.
        }
      }, timeoutMs);
      render(Array.isArray(marks) ? marks : [], timeoutMs, controller?.signal).then(settle, () => settle(null));
    } catch {
      resolve(null);
    }
  });
}

/** Revokes the shot's object URL. Safe to call twice. */
export function releaseShot(shot: Shot): void {
  try {
    if (shot && typeof shot.uri === 'string' && shot.uri) URL.revokeObjectURL(shot.uri);
  } catch {
    // Already gone.
  }
}
