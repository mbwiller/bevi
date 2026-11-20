/** Web only: ZXing decoding of video frames, used by BarcodeCamera.web.tsx and never imported on native (what is shared lives in barcodeCommon.ts). */
/** Loaded only when a scanner is opened, keeping decoding work out of the normal form path. */
export async function loadBarcodeReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'), import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });
}
