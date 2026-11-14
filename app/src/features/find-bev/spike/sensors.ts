// SPIKE S1/S2. Temporary: remove once the iPhone test is done.
//
// The three sensors Find Bev needs, copied from bev-maps@711fd02 (frontend/app/lib/sensors/) and cut
// down to what the spike reads. Web only: every function is called from a tap or an effect on the
// web build, never at import time.

/**
 * Motion & orientation permission (iOS 13+). WebKit only shows the prompt from a user gesture, and
 * the gesture does not survive waiting on another prompt: call this FIRST in the tap handler.
 */
export function requestMotionPermission(): Promise<'granted' | 'denied' | 'not-needed'> {
  const DeviceOrientation = (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent as
    | { requestPermission?: () => Promise<string> }
    | undefined;
  if (typeof DeviceOrientation?.requestPermission !== 'function') return Promise.resolve('not-needed');
  return DeviceOrientation.requestPermission().then(
    (answer) => (answer === 'granted' ? 'granted' : 'denied'),
    () => 'denied',
  );
}

export type CameraResult = { stream: MediaStream; error: null } | { stream: null; error: string };

/** The rear camera, main wide lens (WebKit maps zoom 1 to it; zoom is only accepted in `advanced`). */
export async function openRearCamera(): Promise<CameraResult> {
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, error: 'no getUserMedia' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ zoom: 1 } as MediaTrackConstraintSet],
      },
    });
    return { stream, error: null };
  } catch (e) {
    return { stream: null, error: e instanceof Error ? e.name : String(e) };
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export function liveTracks(stream: MediaStream): number {
  return stream.getTracks().filter((track) => track.readyState === 'live').length;
}

export type CompassSample = { magneticDeg: number | null; accuracyDeg: number | null; pitchDeg: number | null };

const finiteOrNull = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function watchCompass(onSample: (sample: CompassSample) => void): () => void {
  const handler = (event: DeviceOrientationEvent) => {
    const ios = event as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
    onSample({
      magneticDeg: finiteOrNull(ios.webkitCompassHeading),
      accuracyDeg: finiteOrNull(ios.webkitCompassAccuracy),
      pitchDeg: finiteOrNull(event.beta),
    });
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}

export type Fix = { accuracyM: number };

/** One high-accuracy watch from the Find Bev tap until the trip ends. Never reports the position itself. */
export function watchLocation(onFix: (fix: Fix) => void, onError: (reason: string, denied: boolean) => void): () => void {
  if (!('geolocation' in navigator)) {
    onError('no geolocation', true);
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ accuracyM: p.coords.accuracy }),
    (error) => onError(`code ${error.code}`, error.code === error.PERMISSION_DENIED),
    { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
