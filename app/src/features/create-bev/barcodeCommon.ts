/**
 * What both scanners share: `BarcodeCamera.tsx` (native, expo-camera) and `BarcodeCamera.web.tsx`
 * (getUserMedia + ZXing) hand the same string to the same downstream code, so the rule for what a
 * scan is lives here. Nothing here touches a platform API.
 */

/** UPC-A (12 digits), EAN-8 (8) and EAN-13 (13): the retail codes the nutrition lookup takes. UPC-E is not read. */
const RETAIL_BARCODE = /^(?:\d{8}|\d{12}|\d{13})$/;

export function isRetailBarcode(code: string): boolean {
  return RETAIL_BARCODE.test(code);
}

/**
 * The string a scan hands to `onBarcode`. ZXing reports a UPC-A as its 12 digits. AVFoundation
 * (iOS) reports many UPC-A codes as EAN-13 with a leading 0, so a 13-digit EAN-13 or UPC-A that
 * starts with 0 is that code and drops the 0 to match the web. Anything else, or a value that is
 * not a retail barcode, is `null`: the scanner ignores it and keeps looking.
 */
export function normalizeBarcode(type: string, data: string): string | null {
  const code = data.trim();
  if (!isRetailBarcode(code)) return null;
  if ((type === 'ean13' || type === 'upc_a') && code.length === 13 && code.startsWith('0')) return code.slice(1);
  return code;
}

export const CAMERA_OPEN_FAILED = 'Could not open the camera. Allow camera access, enter the barcode below, or upload a label photo.';
