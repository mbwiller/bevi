import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { colors, elevation, type ColorScheme, type Colors } from './tokens';

export * from './tokens';
export { scoreColor } from './score';

export interface Theme {
  scheme: ColorScheme;
  colors: Colors;
  elevation: (typeof elevation)[ColorScheme];
}

const SchemeOverride = createContext<ColorScheme | null>(null);

/**
 * Forces a colour scheme for everything inside it (the ComponentGallery's light/dark toggle).
 * `scheme={null}` follows the system appearance again.
 */
export function ColorSchemeOverride({ scheme, children }: { scheme: ColorScheme | null; children?: ReactNode }) {
  return createElement(SchemeOverride.Provider, { value: scheme }, children);
}

/** Current colours: an enclosing ColorSchemeOverride, else the system appearance. Every component reads colours through this. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const override = useContext(SchemeOverride);
  const scheme: ColorScheme = override ?? (system === 'dark' ? 'dark' : 'light');
  return { scheme, colors: colors[scheme], elevation: elevation[scheme] };
}
