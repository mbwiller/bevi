import { isApiError, type NutritionPreview } from '@bevi/shared';
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

const HOLD_MS = 2000;

/** Read a barcode, reveal nutrition, then require confirmation before adding it to the draft. */
export function NutritionScan({ demoBarcode, value, onChange }: {
  demoBarcode?: string;
  value?: NutritionPreview | null;
  onChange?: (nutrition: NutritionPreview | null) => void;
} = {}) {
  const { colors } = useTheme();
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
        setMessage('Nutrition information unavailable. Try another barcode or close this and upload a label photo.');
      } else {
        setNutrition(result);
        onChange?.(null);
        opacity.value = 0;
        setReveal(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(isApiError(error) && error.code === 'rate_limited' ? error.message : 'Nutrition lookup unavailable. Check the barcode and your connection, then try again.');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }, [opacity, onChange]);
  const cameraError = useCallback((text: string) => { setCamera(false); setMessage(text); }, []);
  const start = () => { setMessage(null); setReveal(false); setOpen(true); setCamera(true); };
  return (
    <View style={styles.stack}>
      <Button variant="outlined" icon="camera" onPress={start} accessibilityLabel="Scan barcode for nutrition">Scan barcode</Button>
      {demoBarcode ? <Button variant="primary" onPress={() => { setOpen(true); setReveal(false); void lookup(demoBarcode); }} accessibilityLabel="Try sample nutrition reveal">Try a sample</Button> : null}
      <Text style={[type.caption, { color: colors.textSecondary }]}>{onChange ? 'Scan the barcode or upload a photo of the label.' : 'Try barcode scanning. This demo does not save nutrition.'}</Text>
      {nutrition ? (
        <View style={styles.stack}>
          <NutritionCard nutrition={nutrition} />
          {onChange ? (
            <>
              <Text style={[type.body, { color: colors.textSecondary }]}>{value === nutrition ? 'Nutrition added to this Bev.' : 'Check that this product and serving size match your drink.'}</Text>
              {value !== nutrition ? <Button onPress={() => onChange(nutrition)} accessibilityLabel="Use this nutrition label">Use this label</Button> : null}
              <Button variant="ghost" onPress={() => { setNutrition(null); onChange(null); }} accessibilityLabel="Remove scanned nutrition">Remove nutrition</Button>
            </>
          ) : null}
        </View>
      ) : null}
      <Sheet open={open} snap={90} title={reveal ? 'Nutrition found' : 'Scan barcode'} onClose={close}>
        <View style={styles.content}>
          <Button variant="ghost" onPress={close} accessibilityLabel="Close barcode scanner">Close</Button>
          {reveal && nutrition ? (
            <Animated.View style={animation} accessibilityLiveRegion="polite"><NutritionCard nutrition={nutrition} reveal /></Animated.View>
          ) : (
            <>
              <Text style={[type.body, { color: colors.text }]}>Point your camera at the barcode. Keep the whole barcode in view. Move back a little until the bars look sharp.</Text>
              {camera ? <BarcodeCamera onBarcode={(code) => void lookup(code)} onError={cameraError} /> : null}
              {busy ? <Text role="status" style={[type.body, { color: colors.textSecondary }]}>Looking up nutrition…</Text> : null}
              {message ? <Text role="alert" style={[type.body, { color: colors.textSecondary }]}>{message}</Text> : null}
              {!camera && !busy ? <Button onPress={() => { setMessage(null); setCamera(true); }} accessibilityLabel="Retry barcode camera">Scan barcode</Button> : null}
              <TextField label="Or enter barcode digits" type="numeric" value={barcode} onChange={(value) => setBarcode(value.replace(/\D/g, ''))} maxLength={13} editable={!busy} />
              <Button variant="outlined" onPress={() => void lookup(barcode)} loading={busy} disabled={busy || !/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)} accessibilityLabel="Look up entered barcode">Look up barcode</Button>
            </>
          )}
        </View>
      </Sheet>
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  content: { padding: spacing.gutter, gap: spacing.lg },
});
