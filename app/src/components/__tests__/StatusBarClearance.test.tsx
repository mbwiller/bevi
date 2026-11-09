import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EDGE_BLUR_BAND, EDGE_STRIP, edgeBlurClearance, isIosHomeScreenApp, StatusBarClearance } from '../StatusBarClearance';

const PORTRAIT = { width: 402, height: 874 };
const LANDSCAPE = { width: 874, height: 402 };
// A translucent-status-bar install (the page runs under the bar) and an opaque one (the page starts below it).
const INSETS = { top: 62, left: 0, right: 0, bottom: 34 };
const OPAQUE = { ...INSETS, top: 0 };

function Probe() {
  const insets = useSafeAreaInsets();
  return <Text testID="insets">{JSON.stringify(insets)}</Text>;
}

async function renderedInsets(insets = INSETS) {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, ...PORTRAIT }, insets }}>
      <StatusBarClearance>
        <Probe />
      </StatusBarClearance>
    </SafeAreaProvider>,
  );
  return JSON.parse(String(screen.getByTestId('insets').props.children)) as typeof INSETS;
}

describe('edgeBlurClearance', () => {
  it('is the blur band under a translucent status bar in portrait', () => {
    expect(edgeBlurClearance(true, PORTRAIT, 62)).toBe(EDGE_BLUR_BAND);
  });

  it("is the strip's height under an opaque status bar in portrait", () => {
    expect(edgeBlurClearance(true, PORTRAIT, 0)).toBe(EDGE_STRIP);
  });

  it('is 0 in landscape, where iOS hides the status bar', () => {
    expect(edgeBlurClearance(true, LANDSCAPE, 62)).toBe(0);
    expect(edgeBlurClearance(true, LANDSCAPE, 0)).toBe(0);
  });

  it('is 0 outside the home-screen app', () => {
    expect(edgeBlurClearance(false, PORTRAIT, 62)).toBe(0);
    expect(edgeBlurClearance(false, PORTRAIT, 0)).toBe(0);
  });
});

describe('StatusBarClearance', () => {
  const realOS = Platform.OS;
  const nav = globalThis.navigator as { standalone?: boolean };
  const realStandalone = nav.standalone;

  afterEach(() => {
    Platform.OS = realOS;
    nav.standalone = realStandalone;
  });

  function homeScreenWeb(standalone: boolean) {
    Platform.OS = 'web';
    nav.standalone = standalone;
  }

  it('detects the iOS home-screen app only on the web with navigator.standalone', () => {
    homeScreenWeb(true);
    expect(isIosHomeScreenApp()).toBe(true);
    homeScreenWeb(false);
    expect(isIosHomeScreenApp()).toBe(false);
    Platform.OS = 'ios';
    nav.standalone = true;
    expect(isIosHomeScreenApp()).toBe(false);
  });

  it('adds the band to a translucent install, leaving the other edges alone', async () => {
    homeScreenWeb(true);
    // jest-expo's window is portrait.
    expect(await renderedInsets()).toEqual({ ...INSETS, top: INSETS.top + EDGE_BLUR_BAND });
  });

  it("adds the strip's height to an opaque install", async () => {
    homeScreenWeb(true);
    expect(await renderedInsets(OPAQUE)).toEqual({ ...OPAQUE, top: EDGE_STRIP });
  });

  it('passes the insets through unchanged in a browser tab', async () => {
    homeScreenWeb(false);
    expect(await renderedInsets()).toEqual(INSETS);
  });
});
