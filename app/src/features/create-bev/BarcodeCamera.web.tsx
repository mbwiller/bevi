import { useEffect, useRef } from 'react';
import { CAMERA_OPEN_FAILED, isRetailBarcode } from './barcodeCommon';
import { loadBarcodeReader } from './barcodeReader';
import { radius, useTheme } from '@/theme';

/** The web scanner (the native one is BarcodeCamera.tsx). DOM island: Safari needs playsInline; ZXing also works where BarcodeDetector is absent. */
export function BarcodeCamera({ onBarcode, onError }: { onBarcode: (code: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onBarcode, onError });
  handlers.current = { onBarcode, onError };
  const { colors } = useTheme();
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let controls: { stop(): void } | undefined;
    const stop = () => {
      cancelled = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
    const pause = () => {
      stop();
      handlers.current.onError('Camera paused. Tap Scan barcode to try again.');
    };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    window.addEventListener('popstate', pause);
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
        // Own the stream so closing during permission or video setup always releases it.
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (cancelled) { stop(); return; }
        const reader = await loadBarcodeReader();
        if (cancelled || !video.current) { stop(); return; }
        controls = await reader.decodeFromStream(stream, video.current, (result, _error, scanner) => {
          if (cancelled || !result) return;
          const code = result.getText();
          if (!isRetailBarcode(code)) return;
          scanner.stop();
          stop();
          handlers.current.onBarcode(code);
        });
        if (cancelled) stop();
      } catch {
        if (cancelled) return;
        stop();
        handlers.current.onError(CAMERA_OPEN_FAILED);
      }
    })();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('popstate', pause);
    };
  }, []);
  return <video ref={video} autoPlay muted playsInline aria-label="Point the rear camera at the product barcode" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', borderRadius: radius.photo, background: colors.input }} />;
}
