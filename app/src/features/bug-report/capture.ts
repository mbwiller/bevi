import { File } from 'expo-file-system';
import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen as shootWindow, releaseCapture } from 'react-native-view-shot';

import { hideReporterLayer } from './layerHidden';
import type { CaptureMark, Shot } from './types';

/**
 * A picture of the app as it is on screen now: the iOS file. The web one, capture.web.ts, redraws
 * the DOM with html2canvas-pro and never reaches here.
 *
 * This is a real screenshot of the key window (`react-native-view-shot`'s `captureScreen`, which
 * draws the window's view hierarchy), so it shows exactly what the tester saw, a Modal or a
 * full-screen flow included, and not a redraw. Two things follow from that:
 *   * the reporter is in the window too, so its layer is hidden first and shown again right after
 *     the shutter (layerHidden.ts): a report opens its note only after the picture is taken;
 *   * the keyboard is a window of its own and is never in it.
 *
 * The picture is a JPEG written by the library to a temporary file, scaled so its long side is at
 * most MAX_SIDE pixels, and its bytes are read into a `Uint8Array` (expo-file-system, as the
 * create-Bev photo does): never a `Blob`, because a React Native Blob uploads as an empty file
 * (`UploadPayload`). The temporary file stays as the note's thumbnail until `releaseShot`.
 *
 * Select element's outlines (`marks`) belong to stage 2 and are ignored here.
 */

const DEFAULT_TIMEOUT_MS = 4000;
/** The long side of the picture, in pixels. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/** The size, in points, that makes the picture's long side at most MAX_SIDE pixels at this screen's scale. */
function sizeInPoints(): { width?: number; height?: number; pixelWidth?: number; pixelHeight?: number } {
  const { width, height } = Dimensions.get('window');
  const scale = PixelRatio.get() || 1;
  if (!(width > 0 && height > 0)) return {};
  const ratio = Math.min(1, MAX_SIDE / (Math.max(width, height) * scale));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  return { width: w, height: h, pixelWidth: Math.round(w * scale), pixelHeight: Math.round(h * scale) };
}

async function take(): Promise<Shot | null> {
  const show = await hideReporterLayer();
  let tmp: string;
  const size = sizeInPoints();
  try {
    tmp = await shootWindow({
      format: 'jpg',
      quality: JPEG_QUALITY,
      result: 'tmpfile',
      ...(size.width && size.height ? { width: size.width, height: size.height } : null),
    });
  } finally {
    // The shutter has gone: the reporter comes back before the file is read.
    show();
  }
  if (typeof tmp !== 'string' || !tmp) return null;
  const uri = tmp.startsWith('file://') ? tmp : `file://${tmp}`;
  try {
    const bytes = await new File(uri).bytes();
    if (!bytes.byteLength) throw new Error('empty_capture');
    return {
      file: bytes,
      mimeType: 'image/jpeg',
      uri,
      width: size.pixelWidth ?? 0,
      height: size.pixelHeight ?? 0,
      tmp,
    };
  } catch {
    releaseTmp(tmp);
    return null;
  }
}

function releaseTmp(tmp: string): void {
  try {
    releaseCapture(tmp);
  } catch {
    // Already gone: it is a temporary file.
  }
}

/**
 * Takes the picture. Resolves null when it cannot (the library is missing, the window can't be
 * drawn, the file can't be read, or `timeoutMs` passes; default 4000). Never rejects.
 */
export function captureScreen(_marks: CaptureMark[], opts?: { timeoutMs?: number }): Promise<Shot | null> {
  const timeoutMs = typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  return new Promise<Shot | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    take().then(
      (shot) => {
        clearTimeout(timer);
        if (settled) {
          // Too late: nobody is waiting for it.
          if (shot) releaseShot(shot);
          return;
        }
        settled = true;
        resolve(shot);
      },
      () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(null);
      },
    );
  });
}

/** Deletes the shot's temporary file. Safe to call twice. */
export function releaseShot(shot: Shot): void {
  if (shot && typeof shot.tmp === 'string' && shot.tmp) releaseTmp(shot.tmp);
}
