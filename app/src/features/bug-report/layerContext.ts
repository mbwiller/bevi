import { createContext, useContext } from 'react';

/**
 * What the reporter's layer (ReportLayer.tsx on iOS, ReportLayer.web.tsx on the web) tells the
 * pieces drawn on it, in a module of their own so both files, and a test, can share it.
 */

/**
 * Spread on the root of everything the reporter draws: `data-report-ui="true"` on the web, so
 * picking skips it and a capture leaves it out. (`dataSet` is react-native-web's; React Native's
 * types don't name it, and it does nothing off the web.)
 */
export const REPORT_UI = { dataSet: { reportUi: 'true' } } as object;

export interface LayerGeometry {
  /** Where the layer's top-left is in the viewport: on a wide window the column starts off the left edge. */
  origin: () => { x: number; y: number };
  width: number;
  height: number;
}

export const LayerContext = createContext<LayerGeometry>({ origin: () => ({ x: 0, y: 0 }), width: 0, height: 0 });

export function useLayer(): LayerGeometry {
  return useContext(LayerContext);
}
