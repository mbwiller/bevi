// Colour arithmetic on theme tokens, standing in for the design system's CSS `color-mix(in srgb, …)`.
// React Native styles take plain colour strings, so the mixes are computed here from the tokens.

type RGBA = [number, number, number, number];

function parse(hex: string): RGBA {
  const h = hex.replace('#', '');
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length >= 8 ? n(6) / 255 : 1];
}

function format([r, g, b, a]: RGBA): string {
  const byte = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}${a >= 1 ? '' : byte(a * 255)}`;
}

/** `color-mix(in srgb, a weight, b)`: `weight` (0–1) of `a`, the rest `b`. Alpha mixes too. */
export function mix(a: string, b: string, weight: number): string {
  const ca = parse(a);
  const cb = parse(b);
  return format(ca.map((v, i) => v * weight + cb[i]! * (1 - weight)) as RGBA);
}

/** `color-mix(in srgb, c amount, transparent)`: scales the colour's own alpha by `amount`. */
export function fade(c: string, amount: number): string {
  const [r, g, b, a] = parse(c);
  return format([r, g, b, a * amount]);
}

/** `color-mix(in srgb, c amount, black)`: darkens toward black, keeping alpha. */
export function shade(c: string, amount: number): string {
  const [r, g, b, a] = parse(c);
  return format([r * amount, g * amount, b * amount, a]);
}
