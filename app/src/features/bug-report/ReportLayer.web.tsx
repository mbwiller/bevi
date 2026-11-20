import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { COLUMN_MAX_WIDTH, isWideViewport } from '@/lib/column';

import { LayerContext, REPORT_UI, useLayer, type LayerGeometry } from './layerContext';
import { REPORT_UI_ATTR } from './types';

export { REPORT_UI, useLayer, type LayerGeometry };

/** Above every Sheet's Modal portal (z-index 9999, `public/index.html`) and the Stack's full-screen modals. */
const LAYER_Z = 10000;

/**
 * The surface the reporter draws on, above everything the app draws: the web file (ReportLayer.tsx
 * is the iOS one).
 *
 * It is a container of its own appended to `<body>` and filled through a portal: fixed, the
 * column's box (lib/column.ts: a centred 480pt column on a wide window, the whole window on a
 * phone), a z-index above the Modal portals, and `pointer-events: none` so the app under it stays
 * usable; the reporter's own controls take pointer events back (`box-none` children). Its transform
 * makes it the containing block of anything fixed inside it, as `index.html` does for the Modal
 * portals.
 */
export function ReportLayer({ children }: { children: ReactNode }) {
  return <WebLayer>{children}</WebLayer>;
}

function WebLayer({ children }: { children: ReactNode }) {
  const win = useWindowDimensions();
  const wide = isWideViewport(win);
  const [el] = useState(() => {
    const div = document.createElement('div');
    // An id, so the Modal-portal rule in index.html (`body > div:not([id]):not([class])`) leaves it alone.
    div.id = 'bevi-report-ui';
    div.setAttribute(REPORT_UI_ATTR, 'true');
    Object.assign(div.style, {
      position: 'fixed',
      top: '0',
      bottom: '0',
      left: '0',
      right: '0',
      margin: '0 auto',
      zIndex: String(LAYER_Z),
      pointerEvents: 'none',
      transform: 'translateZ(0)',
    });
    return div;
  });

  useEffect(() => {
    document.body.appendChild(el);
    // An open Sheet's Modal keeps focus inside itself: its trap listens for `focus` on the
    // document, capturing, and pulls focus back from anywhere outside the Modal, which would take
    // it straight out of the note's text field. A capturing listener on the window runs first and
    // stops `focus` events aimed inside this layer from reaching it. React's own onFocus listens
    // for `focusin`, which this leaves alone.
    const guard = (e: FocusEvent) => {
      if (e.target instanceof Node && el.contains(e.target)) e.stopPropagation();
    };
    window.addEventListener('focus', guard, true);
    return () => {
      window.removeEventListener('focus', guard, true);
      el.remove();
    };
  }, [el]);

  useEffect(() => {
    el.style.maxWidth = wide ? `${COLUMN_MAX_WIDTH}px` : '';
  }, [el, wide]);

  const width = wide ? COLUMN_MAX_WIDTH : win.width;
  const geometry: LayerGeometry = {
    origin: () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top };
    },
    width,
    height: win.height,
  };

  // Required here, not imported: the native test renderer never loads react-dom.
  const { createPortal } = require('react-dom') as { createPortal: (node: ReactNode, container: Element) => ReactNode };
  return createPortal(
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" {...REPORT_UI}>
      <LayerContext.Provider value={geometry}>{children}</LayerContext.Provider>
    </View>,
    el,
  );
}
