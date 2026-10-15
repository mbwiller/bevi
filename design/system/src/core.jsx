import React from 'react';
import { ICON_DATA } from './icons.generated.js';
import { WORDMARK } from './wordmark.generated.js';

export const cx = (...xs) => xs.filter(Boolean).join(' ');

/** Category slugs as the backend seeds them (DEVELOPMENT-ARJUN §3), labels from vision §2, one Lucide icon each. */
export const categories = [
  { id: 'soda', label: 'Soda', icon: 'cup-soda' },
  { id: 'diet_soda', label: 'Diet soda', icon: 'candy-off' },
  { id: 'juice', label: 'Juice', icon: 'citrus' },
  { id: 'water', label: 'Water', icon: 'glass-water' },
  { id: 'sparkling_water', label: 'Sparkling water', icon: 'droplets' },
  { id: 'energy', label: 'Energy', icon: 'zap' },
  { id: 'coffee', label: 'Coffee', icon: 'coffee' },
  { id: 'tea', label: 'Tea', icon: 'leaf' },
  { id: 'boba', label: 'Boba', icon: 'milk' },
  { id: 'sports', label: 'Sports drink', icon: 'dumbbell' },
  { id: 'smoothie', label: 'Smoothie', icon: 'banana' },
  { id: 'beer', label: 'Beer', icon: 'beer', isAlcoholic: true },
  { id: 'wine', label: 'Wine', icon: 'wine', isAlcoholic: true },
  { id: 'spirits_cocktails', label: 'Spirits & cocktails', icon: 'martini', isAlcoholic: true },
  { id: 'other', label: 'Other', icon: 'globe' },
];
export const categoryById = (id) => categories.find((c) => c.id === id);

/** Score band, Beli-style 7 / 4: ≥ 7 high (Loved), ≥ 4 mid (Fine), else low. Rounded to the shown decimal first. */
export function scoreBand(score) {
  if (score == null) return null;
  const s = Math.round(score * 10) / 10;
  return s >= 7 ? 'high' : s >= 4 ? 'mid' : 'low';
}
export const BUCKETS = {
  loved: { label: 'Loved it', band: 'high' },
  fine: { label: 'It was fine', band: 'mid' },
  disliked: { label: "Didn't like it", band: 'low' },
};
export const formatScore = (s) => (Math.round(s * 10) / 10).toFixed(1);
export const formatCount = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
/** "1 rating", "362 ratings", "5k ratings": a Bev's rating count in words, for a meta line. */
export const formatRatings = (n) => formatCount(n) + (n === 1 ? ' rating' : ' ratings');
export const initialsOf = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/** Lucide outline icon. `filled` fills the shape with currentColor (saved bookmark, active heart). */
export function Icon({ name, size = 24, strokeWidth = 1.75, filled = false, className, style, title }) {
  const nodes = ICON_DATA[name];
  if (!nodes) return null;
  return (
    <svg
      className={cx('bv-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
export const iconNames = Object.keys(ICON_DATA);

/** The bevi wordmark as outlined SVG: letters in `primary`, the i's dot as two `fizz` bubbles. */
export function Wordmark({ height = 28, tone = 'brand', title = 'bevi', className }) {
  const w = (WORDMARK.w / WORDMARK.h) * height;
  return (
    <svg
      className={cx('bv-wordmark', 'bv-wordmark-' + tone, className)}
      width={Math.round(w * 10) / 10}
      height={height}
      viewBox={WORDMARK.viewBox}
      role="img"
      aria-label={title}
    >
      <path className="bv-wordmark-ink" d={WORDMARK.letters} />
      <circle className="bv-wordmark-fizz" cx={WORDMARK.bubble.cx} cy={WORDMARK.bubble.cy} r={WORDMARK.bubble.r} />
      <circle className="bv-wordmark-fizz" cx={WORDMARK.fizz.cx} cy={WORDMARK.fizz.cy} r={WORDMARK.fizz.r} />
    </svg>
  );
}

const GLASS = '#ffffff';
const METAL = '#cfcbd6';
const METAL_DARK = '#b3aebd';
const ART_DEFAULTS = {
  can: ['#c8102e', '#ffffff'], slimCan: ['#1d3b8f', '#d7dde8'], bottle: ['#4a2a1a', '#e03a3e'], waterBottle: ['#cfe8f3', '#2b7bb9'],
  boba: ['#c9a27e', '#e85d75'], icedCup: ['#6b4430', '#2a9d8f'], mug: ['#f4efe6', '#4a2a84'], wine: ['#7b1e3a', '#7b1e3a'],
  pint: ['#e3a017', '#e3a017'], carton: ['#f6a623', '#2f9e44'],
};

/**
 * Placeholder product art for mockups until catalog cutouts exist: a flat drink silhouette on a
 * transparent background, the way a real Bev photo arrives after background removal.
 */
export function BevArt({ kind = 'can', color, accent, className, title }) {
  const [c0, a0] = ART_DEFAULTS[kind] || ART_DEFAULTS.can;
  const c = color || c0, a = accent || a0;
  let body;
  switch (kind) {
    case 'slimCan':
      body = (<>
        <rect x="35" y="11" width="30" height="80" rx="4" fill={c} />
        <path d="M37 11 Q37 6 41 6 H59 Q63 6 63 11 Z" fill={METAL} />
        <path d="M37 91 H63 Q63 95 59 95 H41 Q37 95 37 91 Z" fill={METAL_DARK} />
        <path d="M35 36 L65 28 V50 L35 58 Z" fill={a} />
        <rect x="40" y="14" width="3.5" height="74" rx="1.75" fill="#fff" opacity=".28" />
      </>);
      break;
    case 'bottle':
      body = (<>
        <path d="M44 10 H56 V22 C56 28 64 32 64 42 V88 Q64 93 59 93 H41 Q36 93 36 88 V42 C36 32 44 28 44 22 Z" fill={c} />
        <rect x="42.5" y="5" width="15" height="7" rx="1.5" fill={METAL} />
        <rect x="36" y="54" width="28" height="20" fill={a} />
        <rect x="40" y="40" width="3" height="46" rx="1.5" fill="#fff" opacity=".3" />
      </>);
      break;
    case 'waterBottle':
      body = (<>
        <path d="M44 12 H56 V17 Q66 21 66 31 V88 Q66 93 61 93 H39 Q34 93 34 88 V31 Q34 21 44 17 Z" fill={c} />
        <rect x="43" y="4" width="14" height="9" rx="2" fill={a} />
        <rect x="34" y="50" width="32" height="22" fill={a} />
        <path d="M34 40 H66 M34 80 H66" stroke="#fff" strokeOpacity=".7" strokeWidth="2" />
        <rect x="38" y="28" width="3" height="58" rx="1.5" fill="#fff" opacity=".45" />
      </>);
      break;
    case 'boba':
      body = (<>
        <rect x="53" y="2" width="6" height="42" rx="3" fill={a} transform="rotate(12 56 23)" />
        <path d="M30 35 H70 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={c} />
        <path d="M28 34 Q28 19 50 19 Q72 19 72 34 Z" fill={GLASS} fillOpacity=".75" stroke="#000" strokeOpacity=".12" />
        <rect x="26.5" y="32" width="47" height="5" rx="2.5" fill="#ebe7f0" />
        {[[41, 85], [48, 87], [55, 86], [61, 83], [44, 79], [52, 80], [58, 77], [38, 80]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.4" fill="#2e1a12" />
        ))}
        <rect x="35" y="40" width="3" height="34" rx="1.5" fill="#fff" opacity=".35" />
      </>);
      break;
    case 'icedCup':
      body = (<>
        <rect x="53" y="4" width="6" height="40" rx="3" fill={a} transform="rotate(10 56 24)" />
        <path d="M30 32 H70 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={GLASS} fillOpacity=".6" stroke="#000" strokeOpacity=".12" />
        <path d="M31.7 46 H68.3 L65 88 Q64.6 92 60.6 92 H39.4 Q35.4 92 35 88 Z" fill={c} />
        <rect x="38" y="48" width="10" height="10" rx="2" fill="#fff" opacity=".45" transform="rotate(-12 43 53)" />
        <rect x="51" y="52" width="10" height="10" rx="2" fill="#fff" opacity=".35" transform="rotate(10 56 57)" />
        <rect x="27.5" y="29" width="45" height="5" rx="2.5" fill="#ebe7f0" />
      </>);
      break;
    case 'mug':
      body = (<>
        <path d="M36 27 q-4 -6 0 -12 M46 27 q-4 -6 0 -12 M56 27 q-4 -6 0 -12" stroke={METAL_DARK} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M68 47 h5 a10 10 0 0 1 0 20 h-5" stroke={c} strokeWidth="7" fill="none" />
        <rect x="24" y="34" width="46" height="54" rx="9" fill={c} />
        <rect x="24" y="52" width="46" height="11" fill={a} />
        <rect x="29" y="38" width="3.5" height="44" rx="1.75" fill="#fff" opacity=".35" />
      </>);
      break;
    case 'wine':
      body = (<>
        <path d="M33 8 H67 Q69 38 50 51 Q31 38 33 8 Z" fill={GLASS} fillOpacity=".7" stroke="#000" strokeOpacity=".14" />
        <path d="M34.4 24 H65.6 Q64.6 39 50 48.5 Q35.4 39 34.4 24 Z" fill={c} />
        <rect x="48.5" y="50" width="3" height="33" fill="#d8d4de" />
        <ellipse cx="50" cy="86" rx="15" ry="3.6" fill="#d8d4de" />
      </>);
      break;
    case 'pint':
      body = (<>
        <path d="M30 15 H70 L66 88 Q65.6 92 61.6 92 H38.4 Q34.4 92 34 88 Z" fill={c} />
        <path d="M29 18 Q28 9 37 10 Q42 4 50 7 Q58 3 63 9 Q72 8 71 18 L70.6 24 H29.4 Z" fill="#fbf6ea" />
        <rect x="36" y="28" width="3.5" height="56" rx="1.75" fill="#fff" opacity=".3" />
        {[[48, 60], [56, 48], [52, 74]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" fill="#fff" opacity=".55" />)}
      </>);
      break;
    case 'carton':
      body = (<>
        <rect x="41" y="7" width="18" height="6" fill={a} />
        <path d="M32 31 L41 13 H59 L68 31 Z" fill={a} />
        <rect x="32" y="31" width="36" height="60" fill={c} />
        <circle cx="50" cy="58" r="10" fill="#fff" opacity=".85" />
        <circle cx="50" cy="58" r="5" fill={a} />
      </>);
      break;
    default:
      body = (<>
        <rect x="29" y="14" width="42" height="74" rx="5" fill={c} />
        <path d="M31 14 Q31 9 36 9 H64 Q69 9 69 14 Z" fill={METAL} />
        <path d="M31 88 H69 Q69 92 64 92 H36 Q31 92 31 88 Z" fill={METAL_DARK} />
        <rect x="29" y="40" width="42" height="22" fill={a} />
        <rect x="35" y="17" width="4" height="68" rx="2" fill="#fff" opacity=".28" />
      </>);
  }
  return (
    <svg className={cx('bv-art', className)} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {body}
    </svg>
  );
}
export const bevArtKinds = Object.keys(ART_DEFAULTS);
