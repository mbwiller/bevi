import { isApiError, type BarcodeProduct, type NutritionPreview } from '@bevi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { motion, spacing, type, useTheme } from '@/theme';
import { BarcodeCamera } from './BarcodeCamera';
import {
  LABEL_NONE_FOUND, LABEL_PLACEHOLDER_NAME, LABEL_READ_BUTTON, LABEL_READ_CONFIRM, LABEL_READING,
  LABEL_SHEET_HINT, LABEL_UNUSABLE_IMAGE, NAME_MAX_LENGTH, SCAN_LOOKUP_FAILED, SCAN_NO_NUTRITION, SCAN_NOT_FOUND,
} from './copy';
import { NutritionCard } from './NutritionCard';
import { parseNutritionPanel } from './nutritionPanel';
import { PhotoStatusLine } from './PhotoStep';
import type { PhotoSource } from './photo';
import { recogniseText, TEXT_RECOGNITION_AVAILABLE } from './textRecognition';
import type { PhotoUpload } from './usePhotoUpload';

const HOLD_MS = 2000;

export interface NutritionScanProps {
  demoBarcode?: string;
  value?: NutritionPreview | null;
  onChange?: (nutrition: NutritionPreview | null) => void;
  /**
   * The lookup found the product behind the barcode, with or without nutrition: the wizard fills in
   * the new Bev's details from it. Without this the scan is about nutrition alone (the demo).
   * Returning `false` refuses the product (a category the viewer can't see): the scan then shows
   * what a barcode Bevi doesn't know shows, and its label is not offered.
   */
  onProduct?: (product: BarcodeProduct) => boolean | void;
  /**
   * The label the last scan found, confirmed or not, when the caller keeps it (with `onScanned`).
   * The wizard does: its Details step unmounts on the way to step 3, and a label still waiting for
   * "Use this label" has to be there on the way back. Without these the scan keeps it itself.
   */
  scanned?: NutritionPreview | null;
  onScanned?: (nutrition: NutritionPreview | null) => void;
  /**
   * The wizard's label photo slot. It turns on the photo route, where the platform's text recogniser
   * reads the local photo on the device (nothing is sent anywhere); where there is no recogniser
   * (web) the route is not offered.
   */
  label?: PhotoUpload;
  onPickLabel?: (source: PhotoSource) => void;
  /** The name typed so far; a label read is filed under it (the panel does not carry the drink's name). */
  draftName?: string;
}

/**
 * One barcode scan, or one read of the label photo: the sheet, the lookup or the read, the reveal and
 * the label waiting to be confirmed. A hook so the wizard can put the button above the fields a scan fills in and the label
 * down with the nutrition (`NutritionScanResult`, `NutritionScanSheet`); `NutritionScan` is all of
 * it in one place.
 */
export function useNutritionScan({ value, onChange, onProduct, scanned, onScanned, label, onPickLabel, draftName }: Omit<NutritionScanProps, 'demoBarcode'> = {}) {
  const [mode, setMode] = useState<'barcode' | 'label'>('barcode');
  const labelRef = useRef(label);
  labelRef.current = label;
  const nameRef = useRef(draftName);
  nameRef.current = draftName;
  const canRead = TEXT_RECOGNITION_AVAILABLE && !!label;
  const photoUri = label?.photo?.uri ?? null;
  // The photo a label read came from: a different or removed photo makes it stale. A read waiting in
  // the wizard when this step mounts again came from the photo that is still there.
  const readUri = useRef<string | null>((onScanned ? scanned : value)?.source === 'label-ocr' ? photoUri : null);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [own, setOwn] = useState<NutritionPreview | null>(value ?? null);
  const nutrition = onScanned ? scanned ?? null : own;
  const setNutrition = onScanned ?? setOwn;
  // For `lookup`, which is a callback and must not rebuild on every change of the label.
  const nutritionRef = useRef(nutrition);
  nutritionRef.current = nutrition;
  const [reveal, setReveal] = useState(false);
  const request = useRef<AbortController | null>(null);
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  const animation = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const close = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setCamera(false);
    setOpen(false);
    setReveal(false);
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!label || nutrition?.source !== 'label-ocr' || photoUri === readUri.current) return;
    setNutrition(null);
    onChange?.(null);
  }, [label, nutrition, photoUri, setNutrition, onChange]);
  // A message about the last photo ("no panel found") is not about the next one.
  useEffect(() => { setMessage(null); }, [photoUri]);
  useEffect(() => {
    if (!reveal) return;
    const entrance = reduced ? 0 : motion.base;
    const exit = reduced ? 0 : motion.base;
    opacity.value = reduced ? 1 : withTiming(1, { duration: motion.base });
    const fade = setTimeout(() => {
      opacity.value = reduced ? 0 : withTiming(0, { duration: exit });
    }, entrance + HOLD_MS);
    const finish = setTimeout(close, entrance + HOLD_MS + exit);
    return () => { clearTimeout(fade); clearTimeout(finish); };
  }, [reveal, reduced, opacity, close]);

  /** `fromUri` is the photo a label read was made from, captured when the read started. */
  const present = useCallback((result: NutritionPreview, fromUri: string | null = null) => {
    readUri.current = fromUri;
    setNutrition(result);
    onChange?.(null);
    opacity.value = 0;
    setReveal(true);
  }, [opacity, onChange, setNutrition]);

  const lookup = useCallback(async (code: string) => {
    if (request.current) return;
    setMode('barcode');
    setOpen(true);
    setReveal(false);
    setCamera(false);
    setBarcode(code);
    setMessage(null);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!api.nutrition) throw new Error('Nutrition lookup unavailable');
      const product = await api.nutrition.lookupProduct(code, controller.signal);
      if (controller.signal.aborted) return;
      // `onProduct` runs once, here: `false` means the caller refused the product.
      if (!product || onProduct?.(product) === false) {
        setMessage(onProduct ? SCAN_NOT_FOUND : SCAN_NO_NUTRITION);
      } else if (product.nutrition) {
        present(product.nutrition);
      } else if (onProduct) {
        // A product with no nutrition listed still fills in the details, and a label scanned
        // earlier belongs to another barcode. A label READ does not: it came from a photo of the
        // drink in hand, so it stays. There is nothing to reveal, so the sheet just closes.
        if (nutritionRef.current?.source !== 'label-ocr') {
          setNutrition(null);
          onChange?.(null);
        }
        close();
      } else {
        setMessage(SCAN_NO_NUTRITION);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(isApiError(error) && error.code === 'rate_limited' ? error.message : SCAN_LOOKUP_FAILED);
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [onChange, onProduct, setNutrition, close, present]);
  const readLabel = useCallback(async () => {
    const uri = labelRef.current?.photo?.uri;
    if (request.current || !uri) return;
    setMode('label');
    setOpen(true);
    setCamera(false);
    setReveal(false);
    setMessage(null);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      // The local photo, not the upload: the read never waits on the network.
      const lines = await recogniseText(uri);
      // Replaced or removed while it was being read: the reading is of a photo that is gone.
      if (controller.signal.aborted || labelRef.current?.photo?.uri !== uri) return;
      const panel = parseNutritionPanel(lines);
      if (!panel) {
        setMessage(LABEL_NONE_FOUND);
        return;
      }
      present({
        ...panel,
        productName: nameRef.current?.trim().slice(0, NAME_MAX_LENGTH) || LABEL_PLACEHOLDER_NAME,
        barcode: null,
        sourceUrl: null,
        source: 'label-ocr',
      }, uri);
    } catch {
      if (!controller.signal.aborted) setMessage(LABEL_UNUSABLE_IMAGE);
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [present]);
  const cameraError = useCallback((text: string) => { setCamera(false); setMessage(text); }, []);
  const start = () => { setMode('barcode'); setMessage(null); setReveal(false); setOpen(true); setCamera(true); };
  const retry = () => { setMessage(null); setCamera(true); };
  const remove = () => { setNutrition(null); onChange?.(null); };
  // The picker's camera must not open over a barcode camera that is still running.
  const pickLabel = (source: PhotoSource) => { setCamera(false); onPickLabel?.(source); };
  return {
    // `BeviApi.nutrition` is an optional capability (contract 2.14.0). Without it
    // there is nothing to look a barcode up with, so the entry point does not
    // appear at all rather than failing once the person has already scanned. The
    // nutrition-label photo upload beside it stays the route in that case.
    available: !!api.nutrition,
    // Reading the label needs no backend, only the recogniser and a label photo slot to read.
    canRead,
    label, canPickLabel: !!onPickLabel, pickLabel, mode,
    open, camera, barcode, busy, message, nutrition, reveal, animation, value, onChange,
    setBarcode, start, retry, remove, close, lookup, readLabel, cameraError,
  };
}

export type NutritionScanState = ReturnType<typeof useNutritionScan>;

/** The scanned label and, in the wizard, its confirmation: nothing is attached until "Use this label". */
export function NutritionScanResult({ scan }: { scan: NutritionScanState }) {
  const { colors } = useTheme();
  const { nutrition, value, onChange } = scan;
  if (!nutrition) return null;
  return (
    <View style={styles.stack}>
      <NutritionCard nutrition={nutrition} />
      {onChange ? (
        <>
          <Text style={[type.body, { color: colors.textSecondary }]}>{value === nutrition ? 'Nutrition added to this Bev.' : nutrition.source === 'label-ocr' ? LABEL_READ_CONFIRM : 'Check that this product and serving size match your drink.'}</Text>
          {value !== nutrition ? <Button onPress={() => onChange(nutrition)} accessibilityLabel="Use this nutrition label">Use this label</Button> : null}
          <Button variant="ghost" onPress={scan.remove} accessibilityLabel="Remove scanned nutrition">Remove nutrition</Button>
        </>
      ) : null}
    </View>
  );
}

/** Reading the label photo already attached, where the device can (the other way to a label). */
export function NutritionLabelRead({ scan }: { scan: NutritionScanState }) {
  if (!scan.onChange || !scan.canRead || !scan.label?.photo) return null;
  return (
    <Button variant="outlined" icon="file-text" onPress={() => void scan.readLabel()} disabled={scan.busy} accessibilityLabel="Read nutrition from the label photo">{LABEL_READ_BUTTON}</Button>
  );
}

/**
 * The scanner itself: camera, typed digits, the lookup's progress, then the reveal. Reading a label
 * photo shares it, so a read gets the same reveal; a barcode with no result can go straight on to a
 * label photo from here.
 */
export function NutritionScanSheet({ scan }: { scan: NutritionScanState }) {
  const { colors } = useTheme();
  const { open, camera, barcode, busy, message, nutrition, reveal, close, mode, label, canPickLabel, pickLabel } = scan;
  const reading = mode === 'label';
  return (
    <Sheet open={open} snap={90} title={reveal ? (nutrition?.source === 'label-ocr' ? 'Label read' : 'Nutrition found') : reading ? 'Read label' : 'Scan barcode'} onClose={close}>
      <View style={styles.content}>
        <Button variant="ghost" onPress={close} accessibilityLabel={reading ? 'Close label reader' : 'Close barcode scanner'}>Close</Button>
        {reveal && nutrition ? (
          <Animated.View style={scan.animation} accessibilityLiveRegion="polite"><NutritionCard nutrition={nutrition} reveal /></Animated.View>
        ) : (
          <>
            <Text style={[type.body, { color: colors.text }]}>
              {reading ? LABEL_SHEET_HINT : 'Point your camera at the barcode. Keep the whole barcode in view. Move back a little until the bars look sharp.'}
            </Text>
            {!reading && camera ? <BarcodeCamera onBarcode={(code) => void scan.lookup(code)} onError={scan.cameraError} /> : null}
            {busy ? <Text role="status" style={[type.body, { color: colors.textSecondary }]}>{reading ? LABEL_READING : 'Looking up barcode…'}</Text> : null}
            {message ? <Text role="alert" style={[type.body, { color: colors.textSecondary }]}>{message}</Text> : null}
            {!reading && !camera && !busy ? <Button onPress={scan.retry} accessibilityLabel="Retry barcode camera">Scan barcode</Button> : null}
            {!reading ? (
              <>
                <TextField label="Or enter barcode digits" type="numeric" value={barcode} onChange={(value) => scan.setBarcode(value.replace(/\D/g, ''))} maxLength={13} editable={!busy} />
                <Button variant="outlined" onPress={() => void scan.lookup(barcode)} loading={busy} disabled={busy || !/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)} accessibilityLabel="Look up entered barcode">Look up barcode</Button>
              </>
            ) : null}
            {scan.canRead && canPickLabel && label ? (
              <View style={styles.stack}>
                <Text style={[type.body, { color: colors.text }]}>No barcode, or no result? Read it from a photo of the label. Keep the whole Nutrition Facts panel in view and sharp.</Text>
                <View style={styles.row}>
                  <Button variant="outlined" icon="camera" onPress={() => pickLabel('camera')} disabled={busy} accessibilityLabel="Take a photo of the label">Take label photo</Button>
                  <Button variant="outlined" icon="image" onPress={() => pickLabel('library')} disabled={busy} accessibilityLabel="Choose a photo of the label">Choose label photo</Button>
                </View>
                <PhotoStatusLine slot={label} />
                {label.photo ? (
                  <Button onPress={() => void scan.readLabel()} loading={busy && reading} disabled={busy} accessibilityLabel="Read this label photo">{LABEL_READ_BUTTON}</Button>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}

/** Read a barcode, reveal nutrition, then require confirmation before adding it to the draft. */
export function NutritionScan({ demoBarcode, ...options }: NutritionScanProps = {}) {
  const { colors } = useTheme();
  const scan = useNutritionScan(options);
  if (!scan.available) return null;
  return (
    <View style={styles.stack}>
      <Button variant="outlined" icon="camera" onPress={scan.start} accessibilityLabel="Scan barcode for nutrition">Scan barcode</Button>
      {demoBarcode ? <Button variant="primary" onPress={() => void scan.lookup(demoBarcode)} accessibilityLabel="Try sample nutrition reveal">Try a sample</Button> : null}
      <NutritionLabelRead scan={scan} />
      <Text style={[type.caption, { color: colors.textSecondary }]}>{options.onChange ? (scan.canRead ? 'Scan the barcode, or add a photo of the label and read it.' : 'Scan the barcode or upload a photo of the label.') : 'Try barcode scanning. This demo does not save nutrition.'}</Text>
      <NutritionScanResult scan={scan} />
      <NutritionScanSheet scan={scan} />
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.lg },
});
