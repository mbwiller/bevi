import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EDGE_BLUR_BAND, edgeBlurClearance, isIosHomeScreenApp, StatusBarClearance } from '../StatusBarClearance';

const PORTRAIT = { width: 402, height: 874 };
const LANDSCAPE = { width: 874, height: 402 };
const INSETS = { top: 62, left: 0, right: 0, bottom: 34 };

function Probe() {
  const insets = useSafeAreaInsets();
  return <Text testID="insets">{JSON.stringify(insets)}</Text>;
}

async function renderedInsets() {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, ...PORTRAIT }, insets: INSETS }}>
      <StatusBarClearance>
        <Probe />
      </StatusBarClearance>
    </SafeAreaProvider>,
  );
  return JSON.parse(String(screen.getByTestId('insets').props.children)) as typeof INSETS;
}

describe('edgeBlurClearance', () => {
  it('is the blur band in the home-screen app in portrait', () => {
    expect(edgeBlurClearance(true, PORTRAIT)).toBe(EDGE_BLUR_BAND);
  });

  it('is 0 in landscape, where iOS hides the status bar', () => {
    expect(edgeBlurClearance(true, LANDSCAPE)).toBe(0);
  });

  it('is 0 outside the home-screen app', () => {
    expect(edgeBlurClearance(false, PORTRAIT)).toBe(0);
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

  it('adds the band to the top inset in the home-screen app, leaving the other edges alone', async () => {
    homeScreenWeb(true);
    // jest-expo's window is portrait.
    expect(await renderedInsets()).toEqual({ ...INSETS, top: INSETS.top + EDGE_BLUR_BAND });
  });

  it('passes the insets through unchanged in a browser tab', async () => {
    homeScreenWeb(false);
    expect(await renderedInsets()).toEqual(INSETS);
  });
});
