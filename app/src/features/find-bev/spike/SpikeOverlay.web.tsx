// SPIKE S1/S2. Temporary: remove once the iPhone test is done.
//
// The camera view as bev-maps draws it: plain DOM and a CSS module, not React Native. It sits inside
// a React Native Modal (SpikeScreen), so it covers the tab bar without a route change.

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';

import { EDGE_STRIP } from '@/components/StatusBarClearance';

import { formatEntry, log, readLog, subscribeLog } from './log';
import styles from './overlay.module.css';
import { liveTracks, watchCompass, type CompassSample } from './sensors';
import type { SpikeOverlayProps } from './types';

const LOG_TAIL = 5;

export function SpikeOverlay({ stream, topEdge, contextTop, accuracyM, onExit, onCameraLost }: SpikeOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [compass, setCompass] = useState<CompassSample | null>(null);
  const [video, setVideo] = useState('no video yet');
  const entries = useSyncExternalStore(subscribeLog, readLog, readLog);

  // bev-maps@711fd02 camera-view.tsx: attach the stream, and un-freeze it after a background trip.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().then(
      () => log('video.play() resolved'),
      (e: unknown) => log(`video.play() rejected: ${e instanceof Error ? e.name : String(e)}`),
    );
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    const check = () => {
      if (document.hidden) return;
      if (liveTracks(stream) === 0) onCameraLost();
      else videoRef.current?.play().catch(() => {});
    };
    const tracks = stream.getVideoTracks();
    const ended = () => {
      log('camera track fired "ended"');
      check();
    };
    document.addEventListener('visibilitychange', check);
    tracks.forEach((t) => t.addEventListener('ended', ended));
    return () => {
      document.removeEventListener('visibilitychange', check);
      tracks.forEach((t) => t.removeEventListener('ended', ended));
    };
  }, [stream, onCameraLost]);

  // Is the picture really moving? A frozen <video> still reports a size; currentTime tells.
  useEffect(() => {
    let last = -1;
    const timer = setInterval(() => {
      const el = videoRef.current;
      if (!el || !stream) return setVideo(stream ? 'no <video>' : 'no camera');
      const moving = el.currentTime !== last;
      last = el.currentTime;
      setVideo(`${el.videoWidth}×${el.videoHeight} ${moving ? 'playing' : 'FROZEN'} · ${liveTracks(stream)} live`);
    }, 1000);
    return () => clearInterval(timer);
  }, [stream]);

  useEffect(() => {
    let first = true;
    return watchCompass((sample) => {
      if (first) {
        first = false;
        log(`first compass sample: heading ${fmt(sample.magneticDeg)} accuracy ${fmt(sample.accuracyDeg)} pitch ${fmt(sample.pitchDeg)}`);
      }
      setCompass(sample);
    });
  }, []);

  // iOS ignores user-scalable=no. bev-maps stops pinch-zoom for the whole page; here only while the
  // camera view is up, because the tab under it stays mounted.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    return () => document.removeEventListener('gesturestart', stop);
  }, []);

  const rootStyle = {
    top: topEdge === 'below-strip' ? EDGE_STRIP : 0,
    '--safe-top': topEdge === 'clearance' ? `${contextTop}px` : topEdge === 'env' ? 'env(safe-area-inset-top, 0px)' : '0px',
  } as CSSProperties;

  return (
    <div className={styles.screen} style={rootStyle} data-testid="spike-overlay">
      <video ref={videoRef} className={styles.camera} autoPlay playsInline muted />

      <div className={styles.minimap} aria-hidden>
        <div className={styles.minimapInner}>minimap</div>
      </div>

      <button type="button" className={styles.exit} onClick={onExit} aria-label="End navigation">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>

      <div className={`${styles.pill} ${styles.reading}`}>
        {compass ? `${fmt(compass.magneticDeg)}° · pitch ${fmt(compass.pitchDeg)}°` : 'No compass yet'}
        {accuracyM === null ? '' : ` · ±${Math.round(accuracyM)} m`}
      </div>

      <pre className={styles.log}>{entries.slice(-LOG_TAIL).map(formatEntry).join('\n')}</pre>

      <div className={`${styles.pill} ${styles.status}`}>{video}</div>
    </div>
  );
}

function fmt(value: number | null): string {
  return value === null ? '–' : String(Math.round(value));
}
