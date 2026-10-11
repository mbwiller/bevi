import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import type { CategoryId } from '@/lib/categories';

// Placeholder drink cutouts, ported 1:1 from the design system's BevArt (design/system/src/core.jsx).
// These are product colours drawn as a "photo", not interface colours: they are fixed art (a real
// cutout doesn't change in dark mode), so they live here rather than in the theme tokens.
const GLASS = '#ffffff';
const SHINE = '#ffffff';
const SHADE = '#000000';
const METAL = '#cfcbd6';
const METAL_DARK = '#b3aebd';
const LID = '#ebe7f0';
const STEM = '#d8d4de';
const PEARL = '#2e1a12';
const FOAM = '#fbf6ea';

export type BevArtKind = 'can' | 'slimCan' | 'bottle' | 'waterBottle' | 'boba' | 'icedCup' | 'mug' | 'wine' | 'pint' | 'carton';

/** Default [body, accent] per kind, as in the design system. */
const ART_DEFAULTS: Record<BevArtKind, readonly [string, string]> = {
  can: ['#c8102e', '#ffffff'],
  slimCan: ['#1d3b8f', '#d7dde8'],
  bottle: ['#4a2a1a', '#e03a3e'],
  waterBottle: ['#cfe8f3', '#2b7bb9'],
  boba: ['#c9a27e', '#e85d75'],
  icedCup: ['#6b4430', '#2a9d8f'],
  mug: ['#f4efe6', '#4a2a84'],
  wine: ['#7b1e3a', '#7b1e3a'],
  pint: ['#e3a017', '#e3a017'],
  carton: ['#f6a623', '#2f9e44'],
};

export const bevArtKinds = Object.keys(ART_DEFAULTS) as BevArtKind[];

export interface BevArtProps {
  kind?: BevArtKind;
  /** Body or liquid colour (a product colour, not a token). */
  color?: string;
  /** Label, straw or band colour. */
  accent?: string;
  /** Accessible name; without it the art is decorative. */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** The art a Bev without a photo gets: a silhouette that suits its category, in the kind's default colours. */
const CATEGORY_KIND: Record<CategoryId, BevArtKind> = {
  soda: 'can',
  diet_soda: 'can',
  juice: 'carton',
  water: 'waterBottle',
  sparkling_water: 'slimCan',
  energy: 'slimCan',
  coffee: 'mug',
  tea: 'icedCup',
  boba: 'boba',
  sports: 'waterBottle',
  smoothie: 'icedCup',
  beer: 'pint',
  wine: 'wine',
  spirits_cocktails: 'bottle',
  other: 'bottle',
};

export function bevArtForCategory(categoryId: CategoryId): Required<Pick<BevArtProps, 'kind' | 'color' | 'accent'>> {
  const kind = CATEGORY_KIND[categoryId] ?? 'bottle';
  const [color, accent] = ART_DEFAULTS[kind];
  return { kind, color, accent };
}

function body(kind: BevArtKind, c: string, a: string): ReactNode {
  switch (kind) {
    case 'slimCan':
      return (
        <>
          <Rect x={35} y={11} width={30} height={80} rx={4} fill={c} />
          <Path d="M37 11 Q37 6 41 6 H59 Q63 6 63 11 Z" fill={METAL} />
          <Path d="M37 91 H63 Q63 95 59 95 H41 Q37 95 37 91 Z" fill={METAL_DARK} />
          <Path d="M35 36 L65 28 V50 L35 58 Z" fill={a} />
          <Rect x={40} y={14} width={3.5} height={74} rx={1.75} fill={SHINE} opacity={0.28} />
        </>
      );
    case 'bottle':
      return (
        <>
          <Path d="M44 10 H56 V22 C56 28 64 32 64 42 V88 Q64 93 59 93 H41 Q36 93 36 88 V42 C36 32 44 28 44 22 Z" fill={c} />
          <Rect x={42.5} y={5} width={15} height={7} rx={1.5} fill={METAL} />
          <Rect x={36} y={54} width={28} height={20} fill={a} />
          <Rect x={40} y={40} width={3} height={46} rx={1.5} fill={SHINE} opacity={0.3} />
        </>
      );
    case 'waterBottle':
      return (
        <>
          <Path d="M44 12 H56 V17 Q66 21 66 31 V88 Q66 93 61 93 H39 Q34 93 34 88 V31 Q34 21 44 17 Z" fill={c} />
          <Rect x={43} y={4} width={14} height={9} rx={2} fill={a} />
          <Rect x={34} y={50} width={32} height={22} fill={a} />
          <Path d="M34 40 H66 M34 80 H66" stroke={SHINE} strokeOpacity={0.7} strokeWidth={2} />
          <Rect x={38} y={28} width={3} height={58} rx={1.5} fill={SHINE} opacity={0.45} />
        </>
      );
    case 'boba':
      return (
        <>
          <Rect x={53} y={2} width={6} height={42} rx={3} fill={a} transform="rotate(12 56 23)" />
          <Path d="M30 35 H70 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={c} />
          <Path d="M28 34 Q28 19 50 19 Q72 19 72 34 Z" fill={GLASS} fillOpacity={0.75} stroke={SHADE} strokeOpacity={0.12} />
          <Rect x={26.5} y={32} width={47} height={5} rx={2.5} fill={LID} />
          {PEARLS.map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={3.4} fill={PEARL} />
          ))}
          <Rect x={35} y={40} width={3} height={34} rx={1.5} fill={SHINE} opacity={0.35} />
        </>
      );
    case 'icedCup':
      return (
        <>
          <Rect x={53} y={4} width={6} height={40} rx={3} fill={a} transform="rotate(10 56 24)" />
          <Path d="M30 32 H70 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={GLASS} fillOpacity={0.6} stroke={SHADE} strokeOpacity={0.12} />
          <Path d="M31.7 46 H68.3 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={c} />
          <Rect x={38} y={48} width={10} height={10} rx={2} fill={SHINE} opacity={0.45} transform="rotate(-12 43 53)" />
          <Rect x={51} y={52} width={10} height={10} rx={2} fill={SHINE} opacity={0.35} transform="rotate(10 56 57)" />
          <Rect x={27.5} y={29} width={45} height={5} rx={2.5} fill={LID} />
        </>
      );
    case 'mug':
      return (
        <>
          <Path
            d="M36 27 q-4 -6 0 -12 M46 27 q-4 -6 0 -12 M56 27 q-4 -6 0 -12"
            stroke={METAL_DARK}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
          <Path d="M68 47 h5 a10 10 0 0 1 0 20 h-5" stroke={c} strokeWidth={7} fill="none" />
          <Rect x={24} y={34} width={46} height={54} rx={9} fill={c} />
          <Rect x={24} y={52} width={46} height={11} fill={a} />
          <Rect x={29} y={38} width={3.5} height={44} rx={1.75} fill={SHINE} opacity={0.35} />
        </>
      );
    case 'wine':
      return (
        <>
          <Path d="M33 8 H67 Q69 38 50 51 Q31 38 33 8 Z" fill={GLASS} fillOpacity={0.7} stroke={SHADE} strokeOpacity={0.14} />
          <Path d="M34.4 24 H65.6 Q64.6 39 50 48.5 Q35.4 39 34.4 24 Z" fill={c} />
          <Rect x={48.5} y={50} width={3} height={33} fill={STEM} />
          <Ellipse cx={50} cy={86} rx={15} ry={3.6} fill={STEM} />
        </>
      );
    case 'pint':
      return (
        <>
          <Path d="M30 15 H70 L66 88 Q65.6 92 61.6 92 H38.4 Q34.4 92 34 88 Z" fill={c} />
          <Path d="M29 18 Q28 9 37 10 Q42 4 50 7 Q58 3 63 9 Q72 8 71 18 L70.6 24 H29.4 Z" fill={FOAM} />
          <Rect x={36} y={28} width={3.5} height={56} rx={1.75} fill={SHINE} opacity={0.3} />
          {BUBBLES.map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill={SHINE} opacity={0.55} />
          ))}
        </>
      );
    case 'carton':
      return (
        <>
          <Rect x={41} y={7} width={18} height={6} fill={a} />
          <Path d="M32 31 L41 13 H59 L68 31 Z" fill={a} />
          <Rect x={32} y={31} width={36} height={60} fill={c} />
          <Circle cx={50} cy={58} r={10} fill={SHINE} opacity={0.85} />
          <Circle cx={50} cy={58} r={5} fill={a} />
        </>
      );
    case 'can':
    default:
      return (
        <>
          <Rect x={29} y={14} width={42} height={74} rx={5} fill={c} />
          <Path d="M31 14 Q31 9 36 9 H64 Q69 9 69 14 Z" fill={METAL} />
          <Path d="M31 88 H69 Q69 92 64 92 H36 Q31 92 31 88 Z" fill={METAL_DARK} />
          <Rect x={29} y={40} width={42} height={22} fill={a} />
          <Rect x={35} y={17} width={4} height={68} rx={2} fill={SHINE} opacity={0.28} />
        </>
      );
  }
}

const PEARLS: readonly (readonly [number, number])[] = [
  [41, 85], [48, 87], [55, 86], [61, 83], [44, 79], [52, 80], [58, 77], [38, 80],
];
const BUBBLES: readonly (readonly [number, number])[] = [
  [48, 60], [56, 48], [52, 74],
];

/**
 * Placeholder product art: a flat drink silhouette on a transparent background, the way a real Bev
 * photo arrives after background removal. Fills its parent; pass it as `art` to BevImage.
 */
export function BevArt({ kind = 'can', color, accent, title, style }: BevArtProps) {
  const [c0, a0] = ART_DEFAULTS[kind] ?? ART_DEFAULTS.can;
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      style={style}
      // role / aria-label rather than accessibility* props: react-native-svg's web renderer passes
      // its props straight to the DOM <svg>, where only real attributes are valid.
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {body(kind, color ?? c0, accent ?? a0)}
    </Svg>
  );
}
