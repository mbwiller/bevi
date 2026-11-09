// A venue pin's look: the design system's MapCallout (M-16; TASKS.md §1c "white callout") as the
// markup an AdvancedMarkerElement shows, built as a string by pure functions so jest checks it
// without a DOM or Google. Also the blue "you are here" dot.
//
// Beli's Recs callout: a white rounded callout, a coloured circle holding a glyph, the score in
// bold, and a small tail. Bevi's circle is `primary` (grape) with the venue kind's glyph, a
// predicted score gets ScoreBubble's predicted treatment (a dotted ring and a "~" prefix), and a
// venue with no score yet shows "–". The selected pin is raised, larger and on top.

import type { VenuePin } from '@bevi/shared';
import { __iconData as coffeeIcon } from 'lucide-react-native/icons/coffee';
import { __iconData as storeIcon } from 'lucide-react-native/icons/store';

import { formatScore } from '@/lib/format';
import { KIND_LABEL } from '@/lib/venue';
import { motion, radius, size, spacing, type, type Colors } from '@/theme';

export { KIND_LABEL };

type IconData = typeof storeIcon;

/** Chains read as a shop front; craft spots (cafés, delis, bars) as a cup, Beli's most common glyph. */
const KIND_ICON: Record<VenuePin['venue']['kind'], IconData> = { chain: storeIcon, craft: coffeeIcon };

/** The glyph inside the 28pt circle: the design system's 16pt meta-line icon size, stroke 2. */
const GLYPH = 16;
const GLYPH_STROKE = 2;
/** The callout's tail, as on Beli's pins. No token names it. */
const TAIL = 6;
/** The selected pin is raised by this much and grows by SELECTED_SCALE (bundle.css `.bv-callout-selected`). */
export const SELECTED_LIFT = spacing.xs;
export const SELECTED_SCALE = 1.15;
/** What a pin with no score shows. */
export const NO_SCORE = '–';
/** The blue dot: 16pt with a 3pt ring. No token names either. */
const DOT = 16;
const DOT_RING = 3;
/** Marker stacking: the selected pin above every other, the rest best score on top. */
export const SELECTED_Z = 10_000;

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const ATTR = /[&<>"']/g;
const ATTR_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown) => String(v).replace(ATTR, (c) => ATTR_ESC[c]!);

/** A Lucide icon as inline SVG markup (the same paths `lucide-react-native` draws). */
export function iconSvg(icon: IconData, color: string, px: number, strokeWidth: number): string {
  type Node = [string, Record<string, unknown>] | [string, Record<string, unknown>, Node[]];
  const render = (n: Node): string => {
    const [tag, attrs, children] = n;
    const a = Object.entries(attrs)
      .filter(([k]) => k !== 'key')
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join('');
    return `<${tag}${a}>${(children ?? []).map(render).join('')}</${tag}>`;
  };
  const vb = icon.size ?? 24;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${vb} ${vb}" fill="none" ` +
    `stroke="${esc(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    (icon.node as Node[]).map(render).join('') +
    '</svg>'
  );
}

/**
 * The score a pin shows: the best Bayesian score of the venue's assortment when there is one, else
 * the predicted score (dotted ring, "~"). Decided 2026-11-09: `predictedScore` only covers Bevs with
 * no Bayesian score yet, so letting it win would put "~6.0" on a venue that sells a 9.2.
 */
export function pinScore(pin: VenuePin): { value: number | null; predicted: boolean } {
  if (pin.bestScore != null) return { value: pin.bestScore, predicted: false };
  if (pin.predictedScore != null) return { value: pin.predictedScore, predicted: true };
  return { value: null, predicted: false };
}

/** Marker order: selected on top, then higher scores over lower (pins overlap; Beli doesn't cluster). */
export function pinZIndex(pin: VenuePin, selected: boolean): number {
  if (selected) return SELECTED_Z;
  const { value } = pinScore(pin);
  return value == null ? 0 : Math.round(value * 10) + 1;
}

/** The marker's accessible name (Google puts `title` on the focusable marker). */
export function pinLabel(pin: VenuePin): string {
  const { value, predicted } = pinScore(pin);
  const score = value == null ? 'no score yet' : `${predicted ? 'predicted score' : 'score'} ${formatScore(value)}`;
  return `${pin.venue.name}, ${KIND_LABEL[pin.venue.kind].toLowerCase()}, ${score}`;
}

export interface PinLook {
  colors: Colors;
  /** `elevation.floating`: the map is the one place the design system lets things float. */
  floating: string;
  selected: boolean;
  /** Reduce Motion: no grow transition. */
  reduced: boolean;
}

/**
 * The callout's markup. Holds no venue text (the name is the marker's `title`), so nothing from the
 * data is ever parsed as HTML. The outer box is at least 44 × 44 so the whole pin is the tap target.
 */
export function pinHtml(pin: VenuePin, look: PinLook): string {
  const { colors, floating, selected, reduced } = look;
  const { value, predicted } = pinScore(pin);
  const ring = predicted ? `outline:2px dotted ${colors.textSecondary};outline-offset:1px;` : '';
  const circle =
    `<span style="display:flex;align-items:center;justify-content:center;flex-shrink:0;` +
    `width:${size.icon}px;height:${size.icon}px;border-radius:${radius.pill}px;background:${colors.primary};${ring}">` +
    iconSvg(KIND_ICON[pin.venue.kind], colors.onPrimary, GLYPH, GLYPH_STROKE) +
    '</span>';
  const num =
    `<span style="font:700 ${type.heading.fontSize}px/${type.heading.lineHeight}px ${FONT};` +
    `font-variant-numeric:tabular-nums;color:${value == null ? colors.textSecondary : colors.text};white-space:nowrap">` +
    `${value == null ? NO_SCORE : `${predicted ? '~' : ''}${formatScore(value)}`}</span>`;
  const transform = selected ? `transform:translateY(-${SELECTED_LIFT}px) scale(${SELECTED_SCALE});` : '';
  const transition = reduced ? '' : `transition:transform ${motion.fast}ms ease-out;`;
  return (
    `<div data-bevi-pin="${selected ? 'selected' : 'idle'}" aria-hidden="true" style="display:flex;flex-direction:column;` +
    `align-items:center;justify-content:flex-end;min-width:${size.target}px;min-height:${size.target}px;cursor:pointer;` +
    `transform-origin:50% 100%;${transform}${transition}">` +
    // position:relative leaves room for MapCallout's badge slot (trending, bookmark) once the contract has them.
    `<div style="position:relative;display:flex;align-items:center;gap:${spacing.xs}px;padding:${spacing.xs}px;` +
    `padding-right:${spacing.md}px;background:${colors.surface};` +
    `border:1px solid ${selected ? colors.primary : colors.border};border-radius:${radius.pill}px;box-shadow:${floating}">` +
    circle +
    num +
    '</div>' +
    `<div style="width:0;height:0;margin-top:-1px;border-left:${TAIL}px solid transparent;` +
    `border-right:${TAIL}px solid transparent;border-top:${TAIL}px solid ${colors.surface}"></div>` +
    '</div>'
  );
}

/** What a marker's look depends on: when this is unchanged, its markup is left alone. */
export function pinSignature(pin: VenuePin, look: Omit<PinLook, 'colors' | 'floating'> & { scheme: string }): string {
  const { value, predicted } = pinScore(pin);
  return [pin.venue.kind, value ?? '', predicted ? 1 : 0, look.selected ? 1 : 0, look.reduced ? 1 : 0, look.scheme].join('|');
}

/** The blue "you are here" dot: `fizz` with a `surface` ring, on the floating shadow. Holds no data. */
export function locationDotHtml(colors: Colors, floating: string): string {
  return (
    `<div data-bevi-me aria-hidden="true" style="width:${DOT}px;height:${DOT}px;box-sizing:border-box;` +
    `border-radius:${radius.pill}px;background:${colors.fizz};border:${DOT_RING}px solid ${colors.surface};box-shadow:${floating}"></div>`
  );
}
