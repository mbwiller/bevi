// Two glyphs the internal bug reporter needs that the design system's icon set does not have.
// `@/components/Icon` mirrors that set exactly (Icon.test.tsx), and an internal tool is not a
// reason to widen it, so these come straight from Lucide and stay inside this feature.
import CircleDot from 'lucide-react-native/icons/circle-dot';
import MousePointerClick from 'lucide-react-native/icons/mouse-pointer-click';

export const REPORT_GLYPHS = {
  /** Select element. */
  select: MousePointerClick,
  /** Record steps. */
  record: CircleDot,
} as const;

export type ReportGlyph = keyof typeof REPORT_GLYPHS;
