// SPIKE S1/S2 (docs/find-bev-in-app-plan.md, Phase 0). Temporary: remove once the iPhone test is done.
//
// Shown on the Map tab to internal reporters only (MapTabWithSpike), standing in for the real Find
// Bev stage, to answer on a real iPhone what no desk test
// can: do the location, motion and camera prompts fire from react-native-web Pressables; does the
// camera play inside a React Native Modal; do the minimap and × clear the top edge on both install
// types; and does every way out (×, Escape, back swipe, tab switch, sign-out) leave the camera off.
// It finds no store and calls no backend. Position is read for its accuracy only and never leaves
// the phone.

import { useIsFocused } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { PRESSED } from '@/components/HitTarget';
import { isIosHomeScreenApp } from '@/components/StatusBarClearance';
import { radius, size, spacing, type, useTheme } from '@/theme';

import { clearLog, formatEntry, log, logAsText, readLog, subscribeLog } from './log';
import { liveTracks, openRearCamera, requestMotionPermission, stopStream, watchLocation } from './sensors';
import { SpikeOverlay } from './SpikeOverlay';
import type { TopEdgeMode } from './types';

type Phase = 'home' | 'finding' | 'found' | 'starting' | 'navigating';

/** Everything one trip holds open. `end` releases all of it. */
type Trip = { stopLocation: () => void; stream: MediaStream | null; ended: boolean; recovering: boolean };

const BAR_FLAG = 'bar=translucent';
const STATUS_BAR_META = 'meta[name="apple-mobile-web-app-status-bar-style"]';
const isWeb = Platform.OS === 'web' && typeof document !== 'undefined';

const TOP_EDGE_MODES: { id: TopEdgeMode; label: string }[] = [
  { id: 'clearance', label: 'Bevi inset' },
  { id: 'env', label: 'CSS env()' },
  { id: 'below-strip', label: 'Below strip' },
];

const PRIMARY_LABEL: Record<Exclude<Phase, 'navigating'>, string> = {
  home: 'Find Bev',
  finding: 'Finding Bev',
  found: 'Enable camera',
  starting: 'Starting',
};

// An install made by "Translucent install" below launches on /map?bar=translucent (then tap Camera test). Re-apply the style
// as early as the bundle allows, in case iOS reads it at launch and not only when the icon was added.
if (isWeb && window.location.search.includes(BAR_FLAG)) {
  document.querySelector(STATUS_BAR_META)?.setAttribute('content', 'black-translucent');
}

/** What CSS `env(safe-area-inset-*)` resolves to here, which is not what Bevi's inset context reports. */
function cssEnvInset(edge: 'top' | 'bottom'): number {
  if (!isWeb) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;visibility:hidden;padding-top:env(safe-area-inset-${edge},0px)`;
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

function describeEnvironment(contextTop: number, window_: { width: number; height: number }, scheme: string): string {
  if (!isWeb) return 'not a web build';
  const ios = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
  const lines = [
    `install: ${isIosHomeScreenApp() ? 'Home Screen app' : 'browser tab'} · display-mode standalone: ${window.matchMedia('(display-mode: standalone)').matches}`,
    `status bar style: ${document.querySelector(STATUS_BAR_META)?.getAttribute('content') ?? 'none'} · scheme: ${scheme}`,
    `top inset: Bevi context ${contextTop} · CSS env ${cssEnvInset('top')} · bottom env ${cssEnvInset('bottom')}`,
    `window: ${window_.width}×${window_.height} · iOS: ${ios ? `${ios[1]}.${ios[2]}` : 'not iOS'}`,
    `url: ${window.location.pathname}${window.location.search}`,
  ];
  return lines.join('\n');
}

export function SpikeScreen({ onClose }: { /** Back to the Map tab as it ships. */ onClose?: () => void }) {
  const { colors } = useTheme();
  const scheme = useColorScheme() ?? 'light';
  const window_ = useWindowDimensions();
  const contextTop = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const focused = useIsFocused();
  const entries = useSyncExternalStore(subscribeLog, readLog, readLog);

  const [phase, setPhase] = useState<Phase>('home');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [topEdge, setTopEdge] = useState<TopEdgeMode>('clearance');
  const [installHint, setInstallHint] = useState(false);
  const tripRef = useRef<Trip | null>(null);

  const environment = describeEnvironment(contextTop, window_, scheme);
  useEffect(() => {
    log(`environment\n${environment}`);
  }, [environment]);

  /** Ends the trip and says, for the record, whether anything was left running. */
  const end = useCallback((reason: string) => {
    const trip = tripRef.current;
    if (!trip || trip.ended) return;
    trip.ended = true;
    trip.stopLocation();
    if (trip.stream) stopStream(trip.stream);
    log(`trip ended by ${reason}: camera tracks still live = ${trip.stream ? liveTracks(trip.stream) : 0}`);
    tripRef.current = null;
    setStream(null);
    setAccuracyM(null);
    setPhase('home');
  }, []);

  // Tab screens stay mounted, so the Modal and the GPS watch would outlive the tab: end on blur.
  useEffect(() => {
    if (!focused) end('tab blur');
  }, [focused, end]);

  // The root layout swaps the whole Stack on sign-out, a failed token refresh or account deletion.
  useEffect(() => () => end('unmount'), [end]);

  // What the page hears while a trip is up: a back swipe, the app going to the background, a lock.
  useEffect(() => {
    if (!isWeb) return;
    const onPop = () => {
      log(`popstate → ${window.location.pathname}`);
      end('back navigation');
    };
    const onVisibility = () => log(`visibilitychange → ${document.hidden ? 'hidden' : 'visible'}`);
    const onPageHide = () => log('pagehide');
    const onPageShow = () => log('pageshow');
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [end]);

  // Tap one. Location is asked for here.
  const onFind = () => {
    end('a new Find Bev tap');
    log('tap: Find Bev → geolocation.watchPosition');
    const tappedAt = Date.now();
    let first = true;
    const trip: Trip = { stopLocation: () => {}, stream: null, ended: false, recovering: false };
    tripRef.current = trip;
    setPhase('finding');
    trip.stopLocation = watchLocation(
      (fix) => {
        if (trip.ended) return;
        if (first) {
          first = false;
          log(`first fix after ${Date.now() - tappedAt} ms: ±${Math.round(fix.accuracyM)} m`);
          setPhase((p) => (p === 'finding' ? 'found' : p));
        }
        setAccuracyM(fix.accuracyM);
      },
      (reason, denied) => {
        if (trip.ended) return;
        log(`location error: ${reason}${denied ? ' (denied)' : ' (transient, still watching)'}`);
        if (denied) end('location denied');
      },
    );
  };

  // Tap two. Order matters on iPhone: the motion prompt needs this tap's user gesture, which does not
  // survive waiting on the camera prompt, so it is the handler's first statement, before any await.
  const onEnableCamera = () => {
    const motion = requestMotionPermission();
    const camera = openRearCamera();
    const trip = tripRef.current;
    if (!trip || trip.ended) return;
    log('tap: Enable camera → motion permission, then getUserMedia');
    const tappedAt = Date.now();
    setPhase('starting');
    void motion.then((answer) => log(`motion permission: ${answer} after ${Date.now() - tappedAt} ms`));
    void Promise.all([motion, camera]).then(([, result]) => {
      log(result.stream ? `camera: stream after ${Date.now() - tappedAt} ms` : `camera: none (${result.error})`);
      if (trip.ended) {
        // The trip ended while a prompt was up: a stream that arrives late is stopped at once.
        if (result.stream) stopStream(result.stream);
        return;
      }
      trip.stream = result.stream;
      setStream(result.stream);
      setPhase('navigating');
    });
  };

  // iOS can end the camera while the app is in the background. Try once to get it back.
  const onCameraLost = useCallback(() => {
    const trip = tripRef.current;
    if (!trip || trip.ended || trip.recovering) return;
    trip.recovering = true;
    log('camera lost: reopening');
    void openRearCamera().then((result) => {
      trip.recovering = false;
      if (trip.ended) {
        if (result.stream) stopStream(result.stream);
        return;
      }
      if (trip.stream) stopStream(trip.stream);
      trip.stream = result.stream;
      setStream(result.stream);
      log(result.stream ? 'camera recovered' : `camera not recovered (${result.error})`);
    });
  }, []);

  // iOS keeps the status bar style it saw when the icon was added. This makes the page look like an
  // old install would: translucent bar, no manifest (so the icon launches this URL, flag included).
  const onTranslucentInstall = () => {
    if (!isWeb) return;
    document.querySelector(STATUS_BAR_META)?.setAttribute('content', 'black-translucent');
    document.querySelector('link[rel="manifest"]')?.remove();
    window.history.replaceState(window.history.state, '', `/map?${BAR_FLAG}`);
    log('prepared a translucent install: meta set, manifest removed, url flagged');
    setInstallHint(true);
  };

  const onCopy = () => {
    if (!isWeb) return;
    void navigator.clipboard?.writeText(logAsText()).then(
      () => log('log copied'),
      () => log('copy failed: select the log text instead'),
    );
  };

  const busy = phase === 'finding' || phase === 'starting';
  const primaryLabel = phase === 'navigating' ? PRIMARY_LABEL.starting : PRIMARY_LABEL[phase];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Map" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.heading, { color: colors.text }]}>Find Bev spike (S1 / S2)</Text>
        <Text selectable style={[styles.mono, { color: colors.textSecondary }]}>
          {environment}
        </Text>

        <Pressable
          onPress={phase === 'found' ? onEnableCamera : onFind}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: busy }}
          style={({ pressed }) => [styles.primary, { backgroundColor: colors.primary }, busy && styles.busy, pressed && PRESSED]}
        >
          <Text style={[type.heading, { color: colors.onPrimary }]}>{primaryLabel}</Text>
        </Pressable>
        {accuracyM === null ? null : (
          <Text style={[type.caption, { color: colors.textSecondary }]}>GPS fix ±{Math.round(accuracyM)} m</Text>
        )}
        {phase === 'home' ? null : (
          <Chip label="Cancel trip" onPress={() => end('Cancel')} />
        )}

        <Text style={[type.caption, { color: colors.textSecondary }]}>Camera view top edge</Text>
        <View style={styles.row}>
          {TOP_EDGE_MODES.map((mode) => (
            <Chip key={mode.id} label={mode.label} selected={topEdge === mode.id} onPress={() => setTopEdge(mode.id)} />
          ))}
        </View>

        <View style={styles.row}>
          <Chip label="Copy log" onPress={onCopy} />
          <Chip label="Clear log" onPress={clearLog} />
          {onClose ? (
            <Chip
              label="Back to Map"
              onPress={() => {
                end('Back to Map');
                onClose();
              }}
            />
          ) : null}
          {isIosHomeScreenApp() ? null : <Chip label="Translucent install" onPress={onTranslucentInstall} />}
        </View>
        {installHint ? (
          <Text style={[type.caption, { color: colors.text }]}>
            Now Share, then Add to Home Screen. Open the new icon: “top inset” above should read 62 or so, not 0. Reload this
            tab to undo.
          </Text>
        ) : null}

        <Text selectable style={[styles.mono, styles.log, { color: colors.text, backgroundColor: colors.input }]}>
          {entries.length ? entries.map(formatEntry).join('\n') : 'Nothing logged yet.'}
        </Text>
      </ScrollView>

      {/* One URL for the whole trip: a Modal, not a route. It portals out of #root, over the tab bar. */}
      <Modal
        visible={phase === 'navigating'}
        transparent
        animationType="none"
        onRequestClose={() => end('Escape / onRequestClose')}
        onShow={() => log('Modal onShow')}
        {...({ 'aria-label': 'Camera view' } as object)}
      >
        <SpikeOverlay
          stream={stream}
          topEdge={topEdge}
          contextTop={contextTop}
          accuracyM={accuracyM}
          onExit={() => end('×')}
          onCameraLost={onCameraLost}
        />
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.input : colors.surface },
        pressed && PRESSED,
      ]}
    >
      <Text style={[type.caption, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingBottom: spacing.xxl },
  primary: { height: size.target + spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.input },
  busy: { opacity: 0.6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: size.target,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  mono: { fontFamily: Platform.select({ web: 'ui-monospace, Menlo, monospace', default: undefined }), fontSize: 11, lineHeight: 16 },
  log: { padding: spacing.md, borderRadius: radius.input },
});
