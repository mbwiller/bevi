import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

import { mix } from '@/lib/color';
import { useTheme } from '@/theme';

/** The art's side in pt (bundle.css `.bv-findart`); the drawing below is in this 224-unit box. */
export const FIND_ART_SIZE = 224;
const C = FIND_ART_SIZE / 2;
/** The disc's radius: a unit inside the box so its 1pt `border` edge isn't cut. */
const R = C - 1;
/** One id per page is enough: the Map tab mounts a single minimap. */
const CLIP_ID = 'find-bev-clip';

/** The faint street grid: two families of parallel lines, slanted against each other. */
const STREETS_A = [34, 78, 122, 166, 210];
const STREETS_B = [20, 66, 112, 158, 204];
const STREET_WIDTH = 3;
const STREET_OPACITY = 0.12;
/** The walk from you to the place: lit as a wide band, with the route line on top. */
const ROUTE = 'M74 176 L92 96 L150 108 L164 52';
const LIT_WIDTH = 44;
/** `color-mix(in srgb, onDeep 90%, primary)`. */
const LIT_MIX = 0.9;
const ROUTE_WIDTH = 5;
const DOT_STROKE = 4;
const DESTINATION = { cx: 164, cy: 52, r: 11 };
const YOU = { cx: 74, cy: 176, r: 10 };
/** The heading triangle just ahead of the you-are-here dot. */
const HEADING = 'M74 150 L84 168 L64 168 Z';

/**
 * The Map tab's round minimap (design system `FindBevArt`): a `tasteCard` disc with a faint
 * `onDeep` street grid, a lit path from a `fizz` you-are-here dot (with its heading) to a `primary`
 * destination along a `primary` route line. Art only; the tab's button does the navigating.
 */
export function FindArt() {
  const { colors } = useTheme();
  return (
    <Svg
      width={FIND_ART_SIZE}
      height={FIND_ART_SIZE}
      viewBox={`0 0 ${FIND_ART_SIZE} ${FIND_ART_SIZE}`}
      accessibilityRole="image"
      accessibilityLabel="A round minimap: your position, a lit path and a destination"
    >
      <Defs>
        <ClipPath id={CLIP_ID}>
          <Circle cx={C} cy={C} r={R} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${CLIP_ID})`}>
        <Rect x={0} y={0} width={FIND_ART_SIZE} height={FIND_ART_SIZE} fill={colors.tasteCard} />
        {STREETS_A.map((v) => (
          <Path
            key={`a${v}`}
            d={`M${v} -10 L${v - 46} 240`}
            fill="none"
            stroke={colors.onDeep}
            strokeOpacity={STREET_OPACITY}
            strokeWidth={STREET_WIDTH}
          />
        ))}
        {STREETS_B.map((v) => (
          <Path
            key={`b${v}`}
            d={`M-10 ${v} L240 ${v + 44}`}
            fill="none"
            stroke={colors.onDeep}
            strokeOpacity={STREET_OPACITY}
            strokeWidth={STREET_WIDTH}
          />
        ))}
        <Path
          d={ROUTE}
          fill="none"
          stroke={mix(colors.onDeep, colors.primary, LIT_MIX)}
          strokeWidth={LIT_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d={ROUTE} fill="none" stroke={colors.primary} strokeWidth={ROUTE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
        <Circle {...DESTINATION} fill={colors.primary} stroke={colors.onDeep} strokeWidth={DOT_STROKE} />
        <Path d={HEADING} fill={colors.fizz} />
        <Circle {...YOU} fill={colors.fizz} stroke={colors.onDeep} strokeWidth={DOT_STROKE} />
      </G>
      <Circle cx={C} cy={C} r={R} fill="none" stroke={colors.border} strokeWidth={1} />
    </Svg>
  );
}
