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
import { NutritionCard } from './NutritionCard';
import { SCAN_LOOKUP_FAILED, SCAN_NO_NUTRITION, SCAN_NOT_FOUND } from './copy';

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
}

/**
 * One barcode scan: the camera sheet, the lookup, the reveal and the scanned label waiting to be
 * confirmed. A hook so the wizard can put the button above the fields a scan fills in and the label
 * down with the nutrition (`NutritionScanResult`, `NutritionScanSheet`); `NutritionScan` is all of
 * it in one place.
 */
export function useNutritionScan({ value, onChange, onProduct, scanned, onScanned }: Omit<NutritionScanProps, 'demoBarcode'> = {}) {
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [own, setOwn] = useState<NutritionPreview | null>(value ?? null);
  const nutrition = onScanned ? scanned ?? null : own;
  const setNutrition = onScanned ?? setOwn;
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

  const lookup = useCallback(async (code: string) => {
    if (request.current) return;
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
        setNutrition(product.nutrition);
        onChange?.(null);
        opacity.value = 0;
        setReveal(true);
      } else if (onProduct) {
        // A product with no nutrition listed still fills in the details, and a label scanned
        // earlier belongs to another barcode. There is nothing to reveal, so the sheet just closes.
        setNutrition(null);
        onChange?.(null);
        close();
      } else {
        setMessage(SCAN_NO_NUTRITION);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(isApiError(error) && error.code === 'rate_limited' ? error.message : SCAN_LOOKUP_FAILED);
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [opacity, onChange, onProduct, setNutrition, close]);
  const cameraError = useCallback((text: string) => { setCamera(false); setMessage(text); }, []);
  const start = () => { setMessage(null); setReveal(false); setOpen(true); setCamera(true); };
  const retry = () => { setMessage(null); setCamera(true); };
  const remove = () => { setNutrition(null); onChange?.(null); };
  return {
    // `BeviApi.nutrition` is an optional capability (contract 2.14.0). Without it
    // there is nothing to look a barcode up with, so the entry point does not
    // appear at all rather than failing once the person has already scanned. The
    // nutrition-label photo upload beside it stays the route in that case.
    available: !!api.nutrition,
    open, camera, barcode, busy, message, nutrition, reveal, animation, value, onChange,
    setBarcode, start, retry, remove, close, lookup, cameraError,
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
          <Text style={[type.body, { color: colors.textSecondary }]}>{value === nutrition ? 'Nutrition added to this Bev.' : 'Check that this product and serving size match your drink.'}</Text>
          {value !== nutrition ? <Button onPress={() => onChange(nutrition)} accessibilityLabel="Use this nutrition label">Use this label</Button> : null}
          <Button variant="ghost" onPress={scan.remove} accessibilityLabel="Remove scanned nutrition">Remove nutrition</Button>
        </>
      ) : null}
    </View>
  );
}

/** The scanner itself: camera, typed digits, the lookup's progress, then the reveal. */
export function NutritionScanSheet({ scan }: { scan: NutritionScanState }) {
  const { colors } = useTheme();
  const { open, camera, barcode, busy, message, nutrition, reveal, close } = scan;
  return (
    <Sheet open={open} snap={90} title={reveal ? 'Nutrition found' : 'Scan barcode'} onClose={close}>
      <View style={styles.content}>
        <Button variant="ghost" onPress={close} accessibilityLabel="Close barcode scanner">Close</Button>
        {reveal && nutrition ? (
          <Animated.View style={scan.animation} accessibilityLiveRegion="polite"><NutritionCard nutrition={nutrition} reveal /></Animated.View>
        ) : (
          <>
            <Text style={[type.body, { color: colors.text }]}>Point your camera at the barcode. Keep the whole barcode in view. Move back a little until the bars look sharp.</Text>
            {camera ? <BarcodeCamera onBarcode={(code) => void scan.lookup(code)} onError={scan.cameraError} /> : null}
            {busy ? <Text role="status" style={[type.body, { color: colors.textSecondary }]}>Looking up barcode…</Text> : null}
            {message ? <Text role="alert" style={[type.body, { color: colors.textSecondary }]}>{message}</Text> : null}
            {!camera && !busy ? <Button onPress={scan.retry} accessibilityLabel="Retry barcode camera">Scan barcode</Button> : null}
            <TextField label="Or enter barcode digits" type="numeric" value={barcode} onChange={(value) => scan.setBarcode(value.replace(/\D/g, ''))} maxLength={13} editable={!busy} />
            <Button variant="outlined" onPress={() => void scan.lookup(barcode)} loading={busy} disabled={busy || !/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)} accessibilityLabel="Look up entered barcode">Look up barcode</Button>
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
      <Text style={[type.caption, { color: colors.textSecondary }]}>{options.onChange ? 'Scan the barcode or upload a photo of the label.' : 'Try barcode scanning. This demo does not save nutrition.'}</Text>
      <NutritionScanResult scan={scan} />
      <NutritionScanSheet scan={scan} />
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.lg },
});
