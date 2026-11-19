import { isApiError, type NutritionPreview } from '@bevi/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { motion, spacing, type, useTheme } from '@/theme';
import { useOnline } from '@/lib/useOnline';
import { BarcodeCamera } from './BarcodeCamera';
import {
  LABEL_FAILED, LABEL_NONE_FOUND, LABEL_OFFLINE, LABEL_READ_BUTTON, LABEL_READ_CONFIRM, LABEL_READING,
  LABEL_REJECTED, LABEL_UNAVAILABLE, UNREADABLE_IMAGE, UPLOAD_FAILED,
} from './copy';
import { NutritionCard } from './NutritionCard';
import { PhotoStatusLine } from './PhotoStep';
import type { PhotoSource } from './photo';
import type { PhotoUpload } from './usePhotoUpload';

const HOLD_MS = 2000;

/** Why a label read failed, in words that say what to do next. `null` from the reader is handled by the caller. */
function labelFailureMessage(error: unknown): string {
  if (!isApiError(error)) return LABEL_FAILED;
  switch (error.code) {
    case 'network': return LABEL_OFFLINE;
    case 'rate_limited': return error.message;
    case 'validation': return LABEL_REJECTED;
    // The backend predates the reader: say so rather than look broken.
    case 'unknown': return LABEL_UNAVAILABLE;
    default: return LABEL_FAILED;
  }
}

/**
 * Read a barcode, or a photo of the label, reveal nutrition, then require confirmation before
 * adding it to the draft. `label` (the wizard's label photo slot) turns on the photo route.
 */
export function NutritionScan({ demoBarcode, value, onChange, label, onPickLabel }: {
  demoBarcode?: string;
  value?: NutritionPreview | null;
  onChange?: (nutrition: NutritionPreview | null) => void;
  label?: PhotoUpload;
  onPickLabel?: (source: PhotoSource) => void;
} = {}) {
  const { colors } = useTheme();
  const online = useOnline();
  const [mode, setMode] = useState<'barcode' | 'label'>('barcode');
  const labelRef = useRef(label);
  labelRef.current = label;
  const photoUri = label?.photo?.uri ?? null;
  // The photo a label read came from: a different or removed photo makes it stale.
  const readUri = useRef<string | null>(value?.source === 'label-ocr' ? photoUri : null);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<NutritionPreview | null>(value ?? null);
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
  }, [label, nutrition, photoUri, onChange]);
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

  const present = useCallback((result: NutritionPreview) => {
    readUri.current = result.source === 'label-ocr' ? labelRef.current?.photo?.uri ?? null : null;
    setNutrition(result);
    onChange?.(null);
    opacity.value = 0;
    setReveal(true);
  }, [opacity, onChange]);

  const lookup = useCallback(async (code: string) => {
    if (request.current) return;
    setMode('barcode');
    setCamera(false);
    setBarcode(code);
    setMessage(null);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!api.nutrition) throw new Error('Nutrition lookup unavailable');
      const result = await api.nutrition.lookupBarcode(code, controller.signal);
      if (controller.signal.aborted) return;
      if (!result) {
        setMessage('Nutrition information unavailable. Try another barcode, or read the label from a photo.');
      } else {
        present(result);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(isApiError(error) && error.code === 'rate_limited' ? error.message : 'Nutrition lookup unavailable. Check the barcode and your connection, then try again.');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [present]);
  const readLabel = useCallback(async () => {
    const slot = labelRef.current;
    if (request.current || !slot) return;
    setMode('label');
    setOpen(true);
    setCamera(false);
    setReveal(false);
    setMessage(null);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!api.nutrition) throw new Error('Nutrition reading unavailable');
      let assetId: string;
      try {
        assetId = await slot.ensureUploaded();
      } catch (error) {
        if (!controller.signal.aborted) setMessage(!isApiError(error) ? UNREADABLE_IMAGE : error.code === 'network' ? LABEL_OFFLINE : UPLOAD_FAILED);
        return;
      }
      if (controller.signal.aborted) return;
      const result = await api.nutrition.scanLabel(assetId, controller.signal);
      if (controller.signal.aborted) return;
      if (!result) setMessage(LABEL_NONE_FOUND);
      else present(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      // The server lost the photo: the next read uploads it again.
      if (isApiError(error) && error.code === 'validation' && (error.detail as { field?: string } | undefined)?.field === 'labelAssetId') slot.invalidate();
      setMessage(labelFailureMessage(error));
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [present]);
  const cameraError = useCallback((text: string) => { setCamera(false); setMessage(text); }, []);
  const start = () => { setMode('barcode'); setMessage(null); setReveal(false); setOpen(true); setCamera(true); };
  // `BeviApi.nutrition` is an optional capability (contract 2.14.0). Without it
  // there is nothing to look a barcode up with, so the entry point does not
  // appear at all rather than failing once the person has already scanned. The
  // nutrition-label photo upload beside it stays the route in that case.
  if (!api.nutrition) return null;
  return (
    <View style={styles.stack}>
      <Button variant="outlined" icon="camera" onPress={start} accessibilityLabel="Scan barcode for nutrition">Scan barcode</Button>
      {onChange && label?.photo ? (
        <Button variant="outlined" icon="file-text" onPress={() => void readLabel()} disabled={!online || busy} accessibilityLabel="Read nutrition from the label photo">{LABEL_READ_BUTTON}</Button>
      ) : null}
      {onChange && label?.photo && !online ? <Text style={[type.caption, { color: colors.textSecondary }]}>{LABEL_OFFLINE}</Text> : null}
      {demoBarcode ? <Button variant="primary" onPress={() => { setOpen(true); setReveal(false); void lookup(demoBarcode); }} accessibilityLabel="Try sample nutrition reveal">Try a sample</Button> : null}
      <Text style={[type.caption, { color: colors.textSecondary }]}>{onChange ? (label ? 'Scan the barcode, or add a photo of the label and read it.' : 'Scan the barcode or upload a photo of the label.') : 'Try barcode scanning. This demo does not save nutrition.'}</Text>
      {nutrition ? (
        <View style={styles.stack}>
          <NutritionCard nutrition={nutrition} />
          {onChange ? (
            <>
              <Text style={[type.body, { color: colors.textSecondary }]}>{value === nutrition ? 'Nutrition added to this Bev.' : nutrition.source === 'label-ocr' ? LABEL_READ_CONFIRM : 'Check that this product and serving size match your drink.'}</Text>
              {value !== nutrition ? <Button onPress={() => onChange(nutrition)} accessibilityLabel="Use this nutrition label">Use this label</Button> : null}
              <Button variant="ghost" onPress={() => { setNutrition(null); onChange(null); }} accessibilityLabel="Remove scanned nutrition">Remove nutrition</Button>
            </>
          ) : null}
        </View>
      ) : null}
      <Sheet open={open} snap={90} title={reveal ? (nutrition?.source === 'label-ocr' ? 'Label read' : 'Nutrition found') : mode === 'label' ? 'Read label' : 'Scan barcode'} onClose={close}>
        <View style={styles.content}>
          <Button variant="ghost" onPress={close} accessibilityLabel={mode === 'label' ? 'Close label reader' : 'Close barcode scanner'}>Close</Button>
          {reveal && nutrition ? (
            <Animated.View style={animation} accessibilityLiveRegion="polite"><NutritionCard nutrition={nutrition} reveal /></Animated.View>
          ) : (
            <>
              <Text style={[type.body, { color: colors.text }]}>Point your camera at the barcode. Keep the whole barcode in view. Move back a little until the bars look sharp.</Text>
              {camera ? <BarcodeCamera onBarcode={(code) => void lookup(code)} onError={cameraError} /> : null}
              {busy ? <Text role="status" style={[type.body, { color: colors.textSecondary }]}>{mode === 'label' ? LABEL_READING : 'Looking up nutrition…'}</Text> : null}
              {message ? <Text role="alert" style={[type.body, { color: colors.textSecondary }]}>{message}</Text> : null}
              {!camera && !busy ? <Button onPress={() => { setMessage(null); setCamera(true); }} accessibilityLabel="Retry barcode camera">Scan barcode</Button> : null}
              <TextField label="Or enter barcode digits" type="numeric" value={barcode} onChange={(value) => setBarcode(value.replace(/\D/g, ''))} maxLength={13} editable={!busy} />
              <Button variant="outlined" onPress={() => void lookup(barcode)} loading={busy} disabled={busy || !/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)} accessibilityLabel="Look up entered barcode">Look up barcode</Button>
              {label && onPickLabel ? (
                <View style={styles.stack}>
                  <Text style={[type.body, { color: colors.text }]}>No barcode, or no result? Read it from a photo of the label. Keep the whole Nutrition Facts panel in view and sharp.</Text>
                  <View style={styles.row}>
                    <Button variant="outlined" icon="camera" onPress={() => onPickLabel('camera')} disabled={busy} accessibilityLabel="Take a photo of the label">Take label photo</Button>
                    <Button variant="outlined" icon="image" onPress={() => onPickLabel('library')} disabled={busy} accessibilityLabel="Choose a photo of the label">Choose label photo</Button>
                  </View>
                  <PhotoStatusLine slot={label} />
                  {label.photo ? (
                    <Button onPress={() => void readLabel()} loading={busy && mode === 'label'} disabled={!online || busy} accessibilityLabel="Read nutrition from the label photo">{LABEL_READ_BUTTON}</Button>
                  ) : null}
                  {!online ? <Text style={[type.caption, { color: colors.textSecondary }]}>{LABEL_OFFLINE}</Text> : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </Sheet>
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.lg },
});
