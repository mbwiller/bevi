import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

import { layerIsHidden, registerLayer, useLayerHidden } from './layerHidden';
import { LayerContext, REPORT_UI, useLayer, type LayerGeometry } from './layerContext';

export { REPORT_UI, useLayer, type LayerGeometry };

/**
 * The surface the reporter draws on, above everything the app draws: the iOS file (the web one,
 * ReportLayer.web.tsx, is a portal on `<body>`).
 *
 * A full-screen iOS modal (the ranking flow, New Bev, the photo viewer: `fullScreenModal` in the
 * root Stack) is a view controller UIKit presents over the whole window, so anything the root
 * layout draws is under it: that is why the offline strip is not seen there (OfflineNotice.tsx).
 * react-native-screens' `FullWindowOverlay` puts its children in a container added to the key
 * window itself, above the presented modal, and the container passes every touch that lands
 * outside its children down to the app, so the app stays usable around the button and the note. It
 * is a plain view in the window, not a modal: a React Native `Modal` (the app's Sheet) cannot be
 * shown from inside it, which is why the two sheets are drawn beside this layer, not in it
 * (ReportHost) and why they stay closed over a full-screen flow (store.ts, `setSheetsOpen`).
 *
 * The overlay is not an accessibility modal (`unstable_accessibilityContainerViewIsModal`): the
 * note is not modal, and VoiceOver must still reach the app around it.
 *
 * It hides itself for a window screenshot (layerHidden.ts), so the report shows what the tester
 * saw and not the reporter.
 */
export function ReportLayer({ children }: { children: ReactNode }) {
  const layer = <InlineLayer>{children}</InlineLayer>;
  if (Platform.OS !== 'ios') return layer;
  return <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{layer}</FullWindowOverlay>;
}

function InlineLayer({ children }: { children: ReactNode }) {
  const win = useWindowDimensions();
  const [size, setSize] = useState({ width: win.width, height: win.height });
  const hidden = useLayerHidden((s) => s.hidden);

  useEffect(() => registerLayer(), []);
  // Said once the hidden layer has been rendered, which is what a screenshot waits for.
  useEffect(() => {
    if (hidden) layerIsHidden();
  }, [hidden]);

  return (
    <View
      style={[StyleSheet.absoluteFill, hidden && styles.hidden]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width && height) setSize({ width, height });
      }}
      {...REPORT_UI}
    >
      <LayerContext.Provider value={{ origin: () => ({ x: 0, y: 0 }), width: size.width, height: size.height }}>
        {children}
      </LayerContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
