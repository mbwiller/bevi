import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { isOnline } from './connection';

/**
 * Whether the phone is online, for the whole app (native only; a browser's own online and offline
 * events are reliable, so the web files do not use this). One NetInfo listener feeds both the
 * "You're offline" notice (useOnline.ts) and React Query (src/api/queryLifecycle.ts), so the two can
 * never disagree.
 *
 * NetInfo's "offline" is believed at once, but not for good. iOS tells an app about a connection
 * change through a callback that does not always come: never in the iOS Simulator after the Mac's
 * Wi-Fi returns, and not on a phone that changed network while the app was in the background
 * (NetInfo's README). Missing the "back online" one would leave the notice up and every read
 * waiting until the app is restarted. So while NetInfo says offline, the app asks its own backend
 * every few seconds, and any answer at all means there is a connection.
 */

type Listener = (online: boolean) => void;
/** Resolves true when the backend answered (any status), false when the request could not be made. */
export type ConnectionProbe = () => Promise<boolean>;

/** While offline: how often to ask whether the connection is back. */
export const PROBE_OFFLINE_MS = 5_000;
/** While NetInfo still says offline but the backend answers: how often to check that it still does. */
export const PROBE_ONLINE_MS = 20_000;
const PROBE_TIMEOUT_MS = 4_000;

/** Read literally so Expo inlines it at build time. Unset under jest, where there is no probe. */
const PROBE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

async function backendAnswers(): Promise<boolean> {
  if (!PROBE_URL) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // A 401 or a 404 is still an answer: only a request that could not be made means offline.
    await fetch(PROBE_URL, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const listeners = new Set<Listener>();
let probe: ConnectionProbe | null = PROBE_URL ? backendAnswers : null;
let online = true;
/** What NetInfo last said. */
let reported = true;
let stopNetInfo: (() => void) | null = null;
let stopAppState: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Bumped whenever NetInfo speaks or the store stops, so a probe already in flight is ignored. */
let generation = 0;

function set(next: boolean): void {
  if (next === online) return;
  online = next;
  for (const listener of [...listeners]) listener(online);
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function scheduleProbe(ms: number): void {
  clearTimer();
  if (!probe || reported) return;
  const mine = generation;
  const ask = probe;
  timer = setTimeout(() => {
    timer = null;
    void ask()
      .catch(() => false)
      .then((answered) => {
        if (mine !== generation) return;
        set(answered);
        scheduleProbe(answered ? PROBE_ONLINE_MS : PROBE_OFFLINE_MS);
      });
  }, ms);
}

function start(): void {
  stopNetInfo = NetInfo.addEventListener((state) => {
    const next = isOnline(state);
    // Still "no connection" (a change of network type, say): no news. What the backend last
    // answered stands, and the asking carries on, so the notice does not flash back.
    if (!next && !reported) return;
    generation += 1;
    reported = next;
    set(reported);
    if (reported) clearTimer();
    else scheduleProbe(PROBE_OFFLINE_MS);
  });
  // Back in front while offline: ask now. A phone that changed network in the background got no
  // callback, and timers do not run while iOS has the app suspended.
  const subscription = AppState.addEventListener('change', (status) => {
    if (status === 'active' && !reported) {
      generation += 1;
      scheduleProbe(0);
    }
  });
  stopAppState = () => subscription.remove();
}

function stop(): void {
  stopNetInfo?.();
  stopNetInfo = null;
  stopAppState?.();
  stopAppState = null;
  clearTimer();
  generation += 1;
  online = true;
  reported = true;
}

/** Calls `listener` with every change. The first subscriber starts the NetInfo listener, the last one leaving stops it. */
export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) stop();
  };
}

/** Whether the app currently believes it is online. True until NetInfo has said otherwise. */
export function connectionOnline(): boolean {
  return online;
}

/** Replaces how the store asks whether the backend answers; `null` turns the asking off. For tests. */
export function setConnectionProbe(next: ConnectionProbe | null): void {
  probe = next;
}
