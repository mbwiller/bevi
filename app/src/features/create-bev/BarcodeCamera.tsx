import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { radius, spacing, type, useTheme } from '@/theme';
import { CAMERA_OPEN_FAILED, normalizeBarcode } from './barcodeCommon';
import { BARCODE_CAMERA_DENIED, OPEN_SETTINGS, OPEN_SETTINGS_LABEL } from './copy';

/** Retail symbologies only, the ones the web scanner accepts (barcodeCommon.ts). */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a'] as const;
const SCANNER_SETTINGS = { barcodeTypes: [...BARCODE_TYPES] };

function openSettings() {
  void Linking.openSettings().catch(() => undefined);
}

/**
 * The native scanner: expo-camera's CameraView reads barcodes on the device (AVFoundation). The
 * camera permission is a state shown here, not an exception: asked once when the scanner opens, and
 * a refusal is a line with an Open Settings button. The web scanner is BarcodeCamera.web.tsx.
 */
export function BarcodeCamera({ onBarcode, onError }: { onBarcode: (code: string) => void; onError: (message: string) => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const handlers = useRef({ onBarcode, onError });
  handlers.current = { onBarcode, onError };
  // Set synchronously on the first accepted scan: the camera fires its callback many times a second.
  const done = useRef(false);
  const mounted = useRef(true);
  const asked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void requestPermission().catch(() => undefined);
  }, [permission, requestPermission]);
  // A device with no camera (the simulator): iOS has no availability call, so only a definite "no"
  // counts; a throw means "unknown" and the view's own mount error covers it.
  useEffect(() => {
    let live = true;
    CameraView.isAvailableAsync().then(
      (available) => { if (live && !available && !done.current) fail(); },
      () => undefined,
    );
    return () => { live = false; };
  }, []);
  function fail() {
    if (done.current || !mounted.current) return;
    done.current = true;
    setScanning(false);
    handlers.current.onError(CAMERA_OPEN_FAILED);
  }
  const scanned = useCallback((result: BarcodeScanningResult) => {
    if (done.current || !mounted.current) return;
    const code = normalizeBarcode(result.data);
    if (!code) return;
    done.current = true;
    setScanning(false);
    handlers.current.onBarcode(code);
  }, []);

  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <View style={styles.denied} role="alert">
        <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.scoreLow} />
        <Text style={[type.body, styles.flex, { color: colors.text }]}>{BARCODE_CAMERA_DENIED}</Text>
        <Button variant="outlined" onPress={openSettings} accessibilityLabel={OPEN_SETTINGS_LABEL}>{OPEN_SETTINGS}</Button>
      </View>
    );
  }
  return (
    <View style={[styles.frame, { backgroundColor: colors.input }]}>
      {permission?.granted ? (
        <CameraView
          style={styles.fill}
          facing="back"
          active={scanning}
          barcodeScannerSettings={SCANNER_SETTINGS}
          onBarcodeScanned={scanning ? scanned : undefined}
          onMountError={fail}
          accessibilityLabel="Point the rear camera at the product barcode"
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.photo, overflow: 'hidden' },
  fill: { flex: 1 },
  denied: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
});
