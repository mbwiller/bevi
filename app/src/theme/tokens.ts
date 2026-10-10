// Bevi design tokens, ported 1:1 from the design system (claude.ai/artifact/WAYjGiTd5Fu938F6vv6Dyn,
// mirrored in design/system/project/tokens.json). Names follow its "In the app" rule: colour names are
// unchanged, `space-md` → spacing.md, `radius-card` → radius.card, type styles → type.screenTitle.
// Change a value in the design system first; tokens.test.ts fails until this file matches it.

import type { TextStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

const light = {
  surface: '#ffffff',
  input: '#ededed',
  avatarFill: '#eef0f3',
  border: '#e3e3e6',
  borderStrong: '#8e8e93',
  text: '#111111',
  textSecondary: '#69696e',
  primary: '#4a2a84',
  primaryTint: '#efeaf8',
  onPrimary: '#ffffff',
  scoreHigh: '#1c7f46',
  scoreMid: '#9e6500',
  scoreLow: '#c43d39',
  fizz: '#1494a8',
  tasteCard: '#332e80',
  onDeep: '#ffffff',
  badgeRed: '#e05a55',
  photoScrim: '#000000a6',
  scrim: '#11111166',
  glassFill: '#ffffff99',
  glassStroke: '#ffffffcc',
  glassHighlight: '#ffffffe6',
  onScore: '#ffffff',
} as const;

export type ColorName = keyof typeof light;
export type Colors = Record<ColorName, string>;

const dark: Colors = {
  surface: '#121214',
  input: '#232326',
  avatarFill: '#26272b',
  border: '#2e2e33',
  borderStrong: '#6b6b72',
  text: '#f2f2f4',
  textSecondary: '#a1a1a8',
  primary: '#b9a4f2',
  primaryTint: '#2a2142',
  onPrimary: '#1a1030',
  scoreHigh: '#4fcf8a',
  scoreMid: '#f2b544',
  scoreLow: '#ff7b72',
  fizz: '#5fd6e6',
  tasteCard: '#332e80',
  onDeep: '#ffffff',
  badgeRed: '#e05a55',
  photoScrim: '#000000a6',
  scrim: '#000000a6',
  glassFill: '#2c2c33a6',
  glassStroke: '#ffffff26',
  glassHighlight: '#ffffff3d',
  onScore: '#121214',
};

export const colors: Record<ColorScheme, Colors> = { light, dark };

/** 4pt grid; `gutter` is the left and right screen margin on every screen. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  gutter: 16,
} as const;

/** Named by what they round. */
export const radius = {
  button: 8,
  input: 12,
  photo: 14,
  card: 16,
  stat: 20,
  pill: 999,
} as const;

/** Fixed component sizes in pt. Every tap target is at least `size.target`. */
export const size = {
  target: 44,
  header: 44,
  icon: 28,
  pill: 30,
  scoreBubble: 40,
  scoreBubbleLg: 56,
  bevImageStrip: 155,
  featuredCard: 164,
  rowMin: 126,
} as const;

/** System font only (no fontFamily). sectionCaps is always uppercase. */
export const type = {
  displayDrop: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  screenTitle: { fontSize: 20, lineHeight: 25, fontWeight: '700' },
  tabLabel: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  bodyLarge: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  sectionCaps: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  tabBar: { fontSize: 10, lineHeight: 12, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

export type TypeStyle = keyof typeof type;

/** Dense rows cap Dynamic Type here; body text scales freely. */
export const MAX_FONT_SCALE_DENSE = 1.3;

/** Only glass floats. RN's `boxShadow` takes the same CSS strings as the design system. */
export const elevation: Record<ColorScheme, { glass: string; floating: string }> = {
  light: {
    glass: '0 12px 32px #2a145a1f, 0 2px 8px #1111110f',
    floating: '0 4px 12px #11111129',
  },
  dark: {
    glass: '0 12px 32px #00000099, 0 2px 8px #00000066',
    floating: '0 4px 12px #00000099',
  },
};

/** Durations in ms. Animate transform and opacity only; honour reduced motion. */
export const motion = {
  fast: 150,
  base: 250,
  pour: 450,
  springy: { damping: 18, stiffness: 180 },
} as const;
