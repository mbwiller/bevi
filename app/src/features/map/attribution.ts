// The OpenStreetMap credit the venue data needs (ODbL; decision 35, `Venue` in the contract). It is
// a custom control in the map's own LEFT_BOTTOM slot, so it sits just above Google's logo and moves
// with the map's div into any host (part 2's full-screen map gets it for free).

import { spacing, type, type Colors } from '@/theme';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Its CSS, at the size of Google's own attribution (the smallest type style, `tabBar`) on the
 * translucent `glassFill` (plain `surface` under Reduce Transparency), so it stays legible over any
 * tile. Not a link: a 10pt link could not be a 44pt target, and the credit only has to be visible.
 */
export function attributionCss(colors: Colors, reducedTransparency = false): string {
  const t = type.tabBar;
  return (
    `font:${t.fontWeight} ${t.fontSize}px/${t.lineHeight}px system-ui, -apple-system, "Segoe UI", sans-serif;` +
    `color:${colors.text};background:${reducedTransparency ? colors.surface : colors.glassFill};padding:0 ${spacing.xs}px;margin:0 0 ${spacing.xs}px ${spacing.xs}px;` +
    'pointer-events:none;user-select:none;white-space:nowrap'
  );
}
