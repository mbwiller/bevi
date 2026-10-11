import { useColorScheme } from 'react-native';

import { colors, elevation, type ColorScheme, type Colors } from './tokens';

export * from './tokens';
export { scoreColor } from './score';

export interface Theme {
  scheme: ColorScheme;
  colors: Colors;
  elevation: (typeof elevation)[ColorScheme];
}

/** Current colours for the system appearance. Every component reads colours through this. */
export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: colors[scheme], elevation: elevation[scheme] };
}
