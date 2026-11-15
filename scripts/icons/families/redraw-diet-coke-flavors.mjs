import { wrap, shadow, ref, text } from '../style.mjs';

// Redraws of the four flavored Diet Coke cans marked Needs work in the 2026-11-15 review.
// The rejected recipes were in canned-coffee-refreshments-13.mjs (template cans with the
// brand typed in Arial). These are drawn from the January 2018 US 12 fl oz sleek cans:
// one can, one wordmark and one layout; each flavor supplies its stripe color, its name
// and its own line illustration.

// Diet Coke wordmark letterforms, from the public-domain vector of the 2018 logo
// (https://commons.wikimedia.org/wiki/File:Diet_Coke_logo.svg), normalised so each word
// starts at 0,0. The two words are stacked in that lockup; the 2018 can sets them on one
// line, "Diet" enlarged, reading bottom to top, so they are placed separately here.
// COKE is 176.51 x 63.47 units, DIET is 47.2 x 19.08 units.
const COKE = 'M134.91 41.87C134.91 55.32 144.01 63.29 156.96 63.32C171.87 63.32 176.01 51.54 176.51 49.89C176.51 49.89 170.19 56.86 160.87 56.84C151.39 56.84 150.25 46.81 150.01 44.64C155.65 44.66 175.49 44.72 175.49 32.32C175.5 23.41 166.15 18.95 157.86 18.95C143.23 18.95 134.92 28.59 134.91 41.87ZM34.83 57.56C24.12 57.56 16.51 50.16 16.51 31.85C16.52 13.53 23.54 4.16 33.17 4.16C45.13 4.18 50.72 17.9 51.91 20.79L51.9 4.33C47.97 3.28 41.74 0.01 32.58 0C13.77 -0.02 0.01 14.21 0 32.73C-0.02 51.12 12.55 63.47 30.38 63.47C42.69 63.48 49.5 57.38 52.56 53.6C56.54 59.62 63.57 63.18 72.18 63.2C88.6 63.2 97 52.83 97 40.75C97.02 28.73 89.27 18.71 73.15 18.71C61.05 18.69 49.01 25.62 48.99 41.03C48.99 43.87 49.43 46.5 50.25 48.89L50.24 48.87C47.4 52.48 42.27 57.58 34.83 57.56ZM63.52 40.46C63.51 37.14 63.68 22.05 72.55 22.05C80.72 22.05 81.18 34.98 81.16 40.94C81.16 46.88 80.5 59.72 72.18 59.72C63.59 59.72 63.51 45.83 63.52 40.46ZM99.56 3.08L113.2 3.08L113.2 38.59L130.5 18.42L138.71 18.42L124.13 35.28C127.5 40.97 135.62 54.64 140 61.86L126.09 61.86C122.74 56.02 118.69 48.9 116.24 44.57L113.2 48.08L113.2 61.86L99.56 61.86L99.56 3.08ZM149.6 40.53C149.55 26.4 153.59 22.49 157.01 22.49C161.91 22.43 163.84 27.97 163.82 31.99C163.82 40.13 154.26 40.25 149.6 40.53Z';
const DIET = 'M34.07 11.04C33.59 11.58 33.07 12.31 32.65 13.17C32.65 13.17 35.09 12.55 36.43 10.86C36.72 10.48 37.22 9.79 36.88 9.38C36.79 9.25 36.07 8.82 34.07 11.04ZM17.84 3.19C17.62 3.49 17.44 3.86 17.05 4.58C16.68 5.3 15.95 7.41 15.34 8.87C14.28 11.39 12.72 13.65 10.8 15.27C9.19 16.61 8.36 17.18 7.07 17.64C7.07 17.64 7.56 17.82 8.67 17.87C12.95 18.05 16.56 16.14 18.6 13.28C20.49 10.63 21.83 7.05 19.67 3.8C17.63 0.75 8.69 -0.48 3.85 3.69C1.18 6 2.1 9.47 5.88 8C6.54 7.71 7.16 7.2 7.39 6.74C9.57 7.54 12.17 5.85 12.17 5.85C12.17 5.85 10.32 9.99 5.82 10.6C1.23 11.19 -0.05 8.8 0 7.11C0.45 1.47 11.53 -1.81 18.14 1.06C23.55 3.42 24.7 7.56 23.59 10.87C21.95 15.73 17.8 17.81 13.85 18.67C9.6 19.58 6.14 18.75 4.99 18.46C4.5 18.33 4.27 18.19 4.27 18.19C4.27 18.19 5.78 17.14 7.24 15.39C8.45 13.9 9.72 12.1 10.62 10.56C12.71 6.99 15.47 4.16 17.84 3.19ZM29.37 3.5C28.48 4 28.07 4.95 28.48 5.65C28.88 6.37 29.97 6.47 30.81 5.99C31.64 5.53 32.12 4.57 31.7 3.86C31.29 3.15 30.26 3.01 29.37 3.5ZM28.63 15.98C27.67 16.96 26.68 17.85 25.52 18.45C24.58 18.86 23.4 19.27 22.49 18.55C22.05 18.14 22.02 17.45 22.17 16.89C22.35 16.3 22.65 15.75 22.94 15.21L26.9 7.98L27.03 7.91C27.72 7.91 29.83 7.9 29.91 7.91L29.95 7.99L28.59 10.52C28.59 10.52 25.64 15.96 25.51 16.2C25.22 16.75 25.48 17.18 26.33 16.64C27.35 16.01 27.92 15.32 28.54 14.51C29.38 13.43 29.84 11.97 31.27 10.46C32.67 8.97 33.79 8.29 34.98 7.88C36.35 7.41 37.87 7.73 38.22 8.74C38.55 9.6 38.07 10.8 37.46 11.5C36.01 13.15 34.04 14.07 31.98 14.52C31.65 15.02 31.07 17.04 32.9 17C33.93 16.98 34.78 16.41 35.7 15.81C37.3 14.69 38.77 13.28 39.81 11.67C40.3 10.78 40.85 9.9 41.29 9L39.51 9L40.13 7.92L41.91 7.92L43.89 4.45L46.8 4.46C46.8 4.47 45.14 7.61 44.96 7.92C45.38 7.91 47.2 7.91 47.2 7.91L46.66 9L44.38 9L44.06 9.46C44.06 9.46 41.64 13.96 40.8 15.48C40.09 16.75 40.61 16.95 41.14 16.73C41.85 16.43 42.72 15.49 43.03 15.18C43.55 14.56 44.08 13.96 44.52 13.31C44.93 13.3 45.49 13.31 45.67 13.31C44.29 15.58 42.17 18.17 39.49 18.88C38.77 19 37.89 19.02 37.38 18.46C36.88 17.95 36.92 17.09 37.16 16.48C37.24 16.27 37.34 16.05 37.38 15.96L37.3 15.92C35.64 17.46 33.63 18.94 31.4 18.96C30.48 18.96 29.45 18.56 29 17.68C28.54 16.8 28.65 16.2 28.63 15.98Z';

const r2 = n => Math.round(n * 100) / 100;
const WHITE = '#f4f4f2';   // unprinted/white areas of the illustrations
const INK = '#2b292e';     // black copy on the silver
const RED = '#d3202e';     // small Diet Coke lockup at the foot of the can

// 12 oz sleek can, same geometry and rendering as the Good slim cans (Celsius, Alani).
const BODY = 'M73 26Q100 18 127 26L133 42V220Q133 233 100 233T67 220V42Z';
function can(slug, title, label, defs = '') {
  const brushed = Array.from({ length: 17 }, (_, i) => `<path d="M${r2(69.2 + i * 3.85)} 22V234" stroke="${i % 3 === 1 ? '#70767c' : '#fff'}" stroke-opacity="${i % 3 === 1 ? '.045' : '.065'}" stroke-width="${i % 2 ? '.5' : '.9'}"/>`).join('');
  return wrap(slug, title, `${shadow(54)}<path d="${BODY}" fill="${ref('silver')}"/>
<g clip-path="${ref('bodyclip')}">${brushed}${label}<path d="${BODY}" fill="${ref('shade')}" opacity=".8"/>
<path d="M75 48V214" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width="2.8"/>
${Array.from({ length: 25 }, (_, i) => `<ellipse cx="${76 + i * 19 % 50}" cy="${47 + i * 37 % 163}" rx="${i % 4 ? .5 : .9}" ry="${i % 4 ? .8 : 1.4}" fill="#fff" opacity=".2"/>`).join('')}</g>
<ellipse cx="100" cy="26" rx="27" ry="7" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="26" rx="23" ry="4.6" fill="none" stroke="#8d9892" stroke-width=".7"/>
<ellipse cx="104" cy="27" rx="7" ry="2.8" fill="#657169"/>
<path d="M94 24h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="#e6e8de" stroke-width="2.2"/>
<path d="M70 226q30 12 60 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M73 230q27 7 54 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
`<clipPath id="__ID__bodyclip"><path d="${BODY}"/></clipPath><linearGradient id="__ID__silver"><stop stop-color="#a6aaae"/><stop offset=".2" stop-color="#f0f1ef"/><stop offset=".46" stop-color="#dddfe0"/><stop offset=".64" stop-color="#d0d3d6"/><stop offset=".84" stop-color="#a5aaae"/><stop offset="1" stop-color="#dcdedf"/></linearGradient>${defs}`);
}

// The stripe is 30 units wide (44% of the can front, measured on the references) and
// centred. Illustrations change ink where they cross its edge, so two clips split them.
const SX = 85, SW = 30;
const ON = `<clipPath id="__ID__on"><rect x="${SX}" y="0" width="${SW}" height="260"/></clipPath>`;
const OFF = `<clipPath id="__ID__off"><path d="M0 0H${SX}V260H0ZM${SX + SW} 0H200V260H${SX + SW}Z"/></clipPath>`;
const on = inner => `<g clip-path="${ref('on')}">${inner}</g>`;
const off = inner => `<g clip-path="${ref('off')}">${inner}</g>`;
// Illustration coordinates are the pixel coordinates of each reference photo; `place`
// maps them onto the can (stripe centre to x=100, uniform scale from the stripe width).
const place = (tx, ty, k) => inner => `<g transform="translate(${tx} ${ty}) scale(${k})" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;
const dots = (pts, r, fill) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');

const COKE_S = .405, DIET_S = .677;
const wordmark = `<g fill="#fff" fill-rule="evenodd"><path transform="translate(${r2(100 - 63.47 * COKE_S / 2)} 139.5) rotate(-90) scale(${COKE_S})" d="${COKE}"/><path transform="translate(${r2(100 - 19.08 * DIET_S / 2)} 174.5) rotate(-90) scale(${DIET_S})" d="${DIET}"/></g><circle cx="112.1" cy="66.7" r=".9" fill="none" stroke="#fff" stroke-width=".3"/>`;

// Copy that sits on the silver either side of the stripe on every flavor.
const sideCopy = `<rect x="125.3" y="185.5" width="7.4" height="16" rx="2.4" fill="#f7f7f5" opacity=".92"/>
${text(128.9, 192.4, '0', 5.6, INK, 'font-weight="bold" textLength="2.5" lengthAdjust="spacingAndGlyphs"')}<path d="M126.7 195.2h4.5M127.1 197.5h3.7" stroke="${INK}" stroke-width=".8"/>
${text(128.7, 210.8, '12 FL OZ', 3.7, INK, 'font-weight="bold" textLength="7.2" lengthAdjust="spacingAndGlyphs"')}${text(128.7, 215, '(355 mL)', 3.7, INK, 'font-weight="bold" textLength="7.2" lengthAdjust="spacingAndGlyphs"')}
<g transform="translate(68.3 206.3) scale(.05)" fill="${RED}" fill-rule="evenodd"><path transform="translate(0 3.9)" d="${COKE}"/><path transform="translate(116.57 0)" d="${DIET}"/></g>
<path d="M78 209.4h2.6" stroke="${INK}" stroke-width=".4" opacity=".7"/><path d="M68.4 212.2h12.4" stroke="${INK}" stroke-width=".95" opacity=".85"/><path d="M68.4 214.1h8.2" stroke="${INK}" stroke-width=".45" opacity=".7"/>`;

function gingerLime(c) {
  const p = place(28.99, 23.1, .18);
  const stick = 'M240 921 316 842 338 851 244 938Z';
  const chunk = 'M441 917 464 868 476 877 483 893 478 900 447 920Z';
  const slice = 'M254 957Q262 920 300 906Q340 893 375 905Q404 920 418 968L330 1000Q322 1005 316 1000L262 972Z';
  const peelDots = [[345, 1008], [360, 1002], [374, 1000], [352, 1024], [368, 1018], [384, 1016], [362, 1040], [378, 1034], [391, 1040], [380, 1055], [396, 1053], [399, 1068], [414, 1064], [419, 1078], [436, 1077], [454, 1080]];
  return p(`<path d="${stick}" fill="${c}"/><path d="${chunk}" fill="${c}"/>`)
    + on(p(`<path d="${stick}" fill="none" stroke="${WHITE}" stroke-width="3.2"/><path d="${chunk}" fill="none" stroke="${WHITE}" stroke-width="3.2"/>`))
    + p(`<path d="M318 848 334 853 323 858Z" fill="${WHITE}"/><path d="M448 908 466 876 474 892 462 901Z" fill="${WHITE}"/>
<path d="${slice}" fill="${WHITE}"/><path d="M262 960Q269 927 302 914Q340 902 372 913Q398 926 410 970" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="butt"/>
<path d="M320 997 285 947 291 943ZM322 995 311 922 317 921ZM325 995 349 919 355 921ZM330 997 391 944 395 949Z" fill="${c}" stroke="${c}" stroke-width=".7"/>`)
    + off(p(`<path d="${slice}" fill="none" stroke="${c}" stroke-width="1.8"/>`))
    + p(`<path d="M322 1002 383 986Q396 1036 438 1066L472 1079Q420 1092 376 1072Q338 1050 322 1002Z" fill="${WHITE}"/>${dots(peelDots, 2.1, c)}
<path d="M383 987 440 958 490 930Q509 965 508 1005Q505 1050 478 1072Q455 1085 430 1066Q396 1040 383 987Z" fill="${c}"/>
<path d="M450 953 485 938Q497 958 497 978ZM450 963 498 989Q501 1012 494 1036ZM446 969 490 1044Q482 1057 468 1064ZM440 971 461 1066Q438 1062 422 1046ZM433 968 415 1038Q400 1018 391 992Z" fill="none" stroke="${WHITE}" stroke-width="3.7"/>`);
}

function bloodOrange(c) {
  const p = place(27.37, 23.1, .18);
  const f1 = n => Math.round(n * 10) / 10;
  // Cut face of the half orange: an ellipse tilted 16 degrees, with ten segments of cells.
  const cx = 455, cy = 968, tilt = 16 * Math.PI / 180, cs = Math.cos(tilt), sn = Math.sin(tilt);
  const px = 452, py = 958, a = 53, b = 71;
  const reach = th => {
    const dx = Math.cos(th), dy = Math.sin(th);
    const ux = dx * cs + dy * sn, uy = -dx * sn + dy * cs;
    const ox = px - cx, oy = py - cy, qx = ox * cs + oy * sn, qy = -ox * sn + oy * cs;
    const A = ux * ux / a / a + uy * uy / b / b, B = 2 * (qx * ux / a / a + qy * uy / b / b), C = qx * qx / a / a + qy * qy / b / b - 1;
    return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  };
  const at = (th, r) => [px + r * Math.cos(th), py + r * Math.sin(th)];
  const pt = ([x, y]) => `${f1(x)} ${f1(y)}`;
  const mix = (p0, p1, f) => [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
  let veins = '';
  for (let i = 0; i < 10; i++) {
    const t0 = (i * 36 + 12) * Math.PI / 180, t1 = t0 + 31 * Math.PI / 180, tm = (t0 + t1) / 2;
    const tip = at(tm, 9), s0 = at(t0, reach(t0) * .94), s1 = at(t1, reach(t1) * .94), cap = at(tm, reach(tm) * 1.07), end = at(tm, reach(tm) * .97);
    veins += `M${pt(tip)}L${pt(s0)}Q${pt(cap)} ${pt(s1)}Z`;
    veins += `M${pt(mix(tip, end, .3))}L${pt(end)}`;
    for (const f of [.36, .58, .78]) veins += `M${pt(mix(tip, s0, f))}L${pt(mix(tip, end, f + .1))}L${pt(mix(tip, s1, f))}`;
  }
  const rindDots = [];
  for (const [o, from, to, step] of [[10, -38, 128, 15], [21, -14, 112, 14]]) for (let d = from; d <= to; d += step) {
    const x = (59 + o) * Math.cos(d * Math.PI / 180), y = (77 + o) * Math.sin(d * Math.PI / 180);
    rindDots.push([f1(cx + x * cs - y * sn), f1(cy + x * sn + y * cs)]);
  }
  // Wedge on the left: flesh filled with the stripe color, cells drawn in white.
  const A0 = [302, 862], B0 = [428, 966];
  const chain = [[[302, 862], [283, 905], [296, 948]], [[296, 948], [318, 990], [372, 990]], [[372, 990], [405, 988], [428, 966]]];
  const onArc = u => { const s = Math.min(2, Math.floor(u * 3)), t = u * 3 - s, [p0, q, p1] = chain[s]; return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * q[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * q[1] + t * t * p1[1]]; };
  const N = 9, arc = Array.from({ length: N }, (_, i) => onArc(.09 + .83 * i / (N - 1))), starts = Array.from({ length: N }, (_, i) => mix(A0, B0, .13 + .74 * i / (N - 1)));
  let cells = '';
  arc.forEach((e, j) => { const m = mix(starts[j], e, .5), bend = j % 2 ? 3 : -3; cells += `M${pt(mix(starts[j], e, .07))}Q${pt([m[0] + bend, m[1] + bend])} ${pt(mix(starts[j], e, .94))}`; });
  for (let j = 0; j < N - 1; j++) for (const f of (j % 2 ? [.36, .62, .84] : [.24, .5, .74])) { const m0 = mix(starts[j], arc[j], f + .12), m1 = mix(starts[j + 1], arc[j + 1], f + .12); cells += `M${pt(mix(starts[j], arc[j], f))}L${pt(mix(m0, m1, .5))}L${pt(mix(starts[j + 1], arc[j + 1], f))}`; }
  const wedge = 'M302 862Q283 905 296 948Q318 990 372 990Q405 988 428 966Q376 900 302 862Z';
  const rindEllipse = `<ellipse cx="466" cy="984" rx="74" ry="95" transform="rotate(16 466 984)"`;
  return p(`${rindEllipse} fill="${c}"/>`)
    + on(p(`${rindEllipse} fill="none" stroke="${WHITE}" stroke-width="3"/>`))
    + p(`${dots(rindDots, 2, WHITE)}<ellipse cx="${cx}" cy="${cy}" rx="59" ry="77" transform="rotate(16 ${cx} ${cy})" fill="${WHITE}"/>
<path d="${veins}" fill="none" stroke="${c}" stroke-width="2.1"/><circle cx="${px}" cy="${py}" r="3.4" fill="${WHITE}"/>
<path d="M303 976Q350 1004 400 997Q428 990 440 962L452 966Q444 996 402 1010Q350 1016 303 976Z" fill="${c}" stroke="${WHITE}" stroke-width="2.6"/>
${dots([[348, 1000], [358, 1004], [368, 1001], [378, 1006], [388, 1002], [398, 1005], [408, 1000], [418, 999], [426, 992], [434, 988], [440, 978], [445, 970], [413, 1005], [431, 996]], 1.6, WHITE)}
<path d="${wedge}" fill="${c}" stroke="${WHITE}" stroke-width="6"/><path d="${wedge}" fill="${c}"/>
<path d="${cells}" fill="none" stroke="${WHITE}" stroke-width="1.9"/>`);
}

function feistyCherry() {
  const p = place(-1.89, 26.5, .41);
  const stemL = 'M214 402Q202 384 194 351', stemR = 'M271 407Q274 386 289 366Q300 352 311 339';
  const light = [[244, 428], [247, 433], [252, 437], [241, 436], [245, 446], [254, 444], [272, 452], [276, 448], [268, 456], [281, 444], [262, 458], [285, 437]];
  return off(p(`<path d="${stemL}" fill="none" stroke="#8b7686" stroke-width="2.3"/><ellipse cx="193.4" cy="348.6" rx="2.2" ry="2.6" fill="#e9e9ea" stroke="#8b7686" stroke-width=".9"/><path d="${stemR}" fill="none" stroke="#9d96a2" stroke-width="3.4"/>`))
    + p(`<path d="${stemL}" fill="none" stroke="#fff" stroke-width="1.5"/><path d="${stemR}" fill="none" stroke="#fff" stroke-width="2.2"/>
<path d="M214 402Q222 391 234 392Q245 394 250 406L238 444Q222 445 211 433Q202 420 206 410Q209 404 214 402Z" fill="${ref('pale')}" stroke="#fff" stroke-width=".9"/>
${dots([[209, 414], [210, 421], [213, 427], [216, 432], [221, 437], [227, 440], [212, 417], [215, 424], [219, 430], [224, 435], [217, 420], [221, 427]], .7, '#7f8089')}
<path d="M247 405Q256 399 266 404Q270 407 276 407Q290 411 293 426Q294 444 280 456Q266 465 250 462Q236 456 233 440Q230 420 238 410Q242 406 247 405Z" fill="${ref('dark')}" stroke="#fff" stroke-width="1"/>
<path d="M248 437.2 249 440 251.8 441 249 442 248 444.8 247 442 244.2 441 247 440Z" fill="#fff"/>${dots(light, .5, '#d9a9c6')}`);
}

function twistedMango(deep) {
  const p = place(-.49, 33.1, .21);
  return p(`<path d="M598 680Q607 730 580 768Q556 796 524 806L480 772Z" fill="${deep}" stroke="#ffeec6" stroke-width="1.6"/>
<path d="M480 772Q540 740 598 680Q592 734 556 764Q530 780 506 787Z" fill="#fff"/>
<path d="M365 756Q344 776 354 800Q366 820 394 825L384 800Q370 780 372 756Z" fill="${deep}"/><path d="M368 757 386 753 402 824 386 823Q364 800 368 757Z" fill="#fff"/>
<path d="M527 797Q538 820 528 842Q514 858 478 858Q448 856 428 850L470 840Z" fill="#e9e9eb" stroke="#ffeec6" stroke-width="1.4"/>
${dots([[520, 812], [526, 826], [515, 830], [520, 842], [506, 838], [498, 848], [488, 842], [476, 850], [464, 846], [452, 850], [508, 822], [494, 834]], 1.5, '#c98b2b')}
<path d="M381 726 440 750 480 772 527 797Q506 826 470 845Q432 856 406 838Q386 815 381 770Z" fill="${deep}" stroke="#ffeec6" stroke-width="1.7"/>`);
}

const name = (y, label, len) => text(100, y, label, 6.5, '#fff', `font-weight="bold" textLength="${len}" lengthAdjust="spacingAndGlyphs"`);
const flavors = [
  { slug: 'diet-coke-feisty-cherry', flavor: 'Feisty Cherry', c: '#6e1147', lines: [['FEISTY', 19.9], ['CHERRY', 24.2]],
    art: () => feistyCherry(),
    defs: OFF + `<linearGradient id="__ID__pale" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3f3f2"/><stop offset=".5" stop-color="#d6d7da"/><stop offset="1" stop-color="#a6a8af"/></linearGradient><radialGradient id="__ID__dark" cx=".4" cy=".35" r=".75"><stop stop-color="#8a1c5c"/><stop offset="1" stop-color="#650f41"/></radialGradient>` },
  { slug: 'diet-coke-ginger-lime', flavor: 'Ginger Lime', c: '#6da203', lines: [['GINGER', 23.3], ['LIME', 13.9]], art: gingerLime, defs: ON + OFF },
  { slug: 'diet-coke-twisted-mango', flavor: 'Twisted Mango', c: '#fbab1c', lines: [['TWISTED', 24.3], ['MANGO', 21.2]], art: () => twistedMango('#f39a12'), defs: '' },
  { slug: 'diet-coke-zesty-blood-orange', flavor: 'Zesty Blood Orange', c: '#f04a05', lines: [['ZESTY', 19], ['BLOOD', 21.1], ['ORANGE', 25.9]], art: bloodOrange, defs: ON },
];

function draw(f) {
  const ys = f.lines.length === 3 ? [46.2, 52.3, 58.4] : [46, 52];
  const label = `<rect x="${SX}" y="12" width="${SW}" height="224" fill="${f.c}"/>
${f.lines.map(([w, len], i) => name(ys[i], w, len)).join('')}
${wordmark}
${f.art(f.c)}
${sideCopy}`;
  return can(f.slug, `Diet Coke ${f.flavor}`, label, f.defs);
}

const SHARED_SEEN = 'Tall, slim 12 fl oz sleek can in bright brushed silver with a single wide flavor-colored stripe running the full height of the front, centred, about 41 to 44 percent of the visible width. At the top of the stripe the flavor name in small white bold sans capitals; below it the Diet Coke wordmark in white, very large, reading bottom to top: script "Diet" followed on the same line by the heavy serif "Coke" with a registered mark. On the silver to the right a white "0 CALORIES PER CAN" lozenge above black "12 FL OZ (355 mL)"; at lower left a small red stacked Diet Coke logo with a black flavor descriptor.';
const SHARED_DOUBT = 'Body drawn at the house slim-can width (ratio 0.31, identical to the Good Celsius and Alani cans) although the photos measure 0.35 to 0.38. Wordmark letterforms are the 2018 logo vector re-set on one line; the size of "Diet" relative to "Coke" and all positions were measured on the BevNET Ginger Lime photo and reused for the four flavors. Flavor name is Arial Bold condensed with textLength (the can uses a geometric sans). "CALORIES PER CAN" and the flavor descriptor are reduced to hairlines; "12 FL OZ (355 mL)" is set small and heavily condensed. The house lid hides the top of the stripe, so the flavor name sits slightly lower than on the can. Historical package: the retailer and BevNET product pages the earlier batch recorded refuse automated requests, so the page recorded is the dated trade article that names the four flavors and the sleek 12 oz can; the image was opened directly. Discontinuation date not confirmed here.';
const evidence = {
  'diet-coke-feisty-cherry': {
    imageUrl: 'https://www.kroger.com/product/images/large/front/0004900007511',
    observations: `Kroger front packshot (500 px retailer render) of Diet Coke Feisty Cherry. ${SHARED_SEEN} Stripe is a dark berry purple (sampled #6e1147). Name on two lines, FEISTY / CHERRY. Illustration at the foot: two cherries overlapping the stripe, a pale silver stippled cherry behind on the left with a thin stem rising up and left across the silver, and a dark purple cherry in front with a fine white outline, a white highlight speck and light stippling, its pale stem rising up and right past the stripe edge.`,
    uncertainty: `${SHARED_DOUBT} Reference is a small retailer render, so the cherries' stippled shading is reduced to a few dots and a gradient; the front cherry is filled slightly lighter than the stripe so it stays visible at tile size.`,
  },
  'diet-coke-ginger-lime': {
    imageUrl: 'https://d2iiahg0ip5afn.cloudfront.net/media/diet_coke/images/818375593.cocacola-12oz-diet-gingerlime-front.jpg',
    observations: `BevNET front photograph (800x1200, EXIF date 2018-01-17) of Diet Coke Ginger Lime. ${SHARED_SEEN} Stripe is lime green (sampled #6ea200). Name on two lines, GINGER / LIME. Illustration at the foot, drawn as line art that is green on the silver and white on the stripe: a lime half-slice with a green rind band and pale segments at left, a green lime wedge with white-outlined segments at right running past the stripe edge, a pale dotted peel between them, a long ginger stick at upper left and a small ginger chunk at upper right.`,
    uncertainty: `${SHARED_DOUBT} Lime segments are simplified (four dividers on the slice, five outlined segments on the wedge, scalloped segment edges omitted); the peel carries 16 dots where the can has many finer ones.`,
  },
  'diet-coke-twisted-mango': {
    imageUrl: 'https://images.heb.com/is/image/HEBGrocery/002203808-1',
    observations: `H-E-B front packshot (960 px retailer render) of Diet Coke Twisted Mango. ${SHARED_SEEN} Stripe is mango yellow-orange (sampled #fbab1c). Name on two lines, TWISTED / MANGO. Illustration at the foot: an orange mango wedge in front with a fine pale outline and a silver dotted cut face below it, a second slice behind it rising to the upper right with white flesh and orange skin, and a small white-and-orange piece at the left.`,
    uncertainty: `${SHARED_DOUBT} The mango pieces are filled slightly deeper than the stripe so they separate from it at tile size; the reference shows them almost the same orange with only a hairline outline.`,
  },
  'diet-coke-zesty-blood-orange': {
    imageUrl: 'https://d2iiahg0ip5afn.cloudfront.net/media/diet_coke/images-primary/100922106.cocacola-12oz-diet-zestybloodorange-front.jpg',
    observations: `BevNET front photograph (800x1200, EXIF date 2018-01-17) of Diet Coke Zesty Blood Orange. ${SHARED_SEEN} Stripe is red-orange (sampled #f34a00). Name on three lines, ZESTY / BLOOD / ORANGE. Illustration at the foot: an orange wedge at left with its pulp cells drawn in white and a dotted rind band beneath it, overlapping a cut half orange at right whose face is pale with the cells drawn in orange line, sitting in an orange rind crescent with white dots that runs past the stripe edge.`,
    uncertainty: `${SHARED_DOUBT} The pulp cells are a regular pattern (ten segments on the cut face, nine veins on the wedge) standing in for the can's dense irregular hand-drawn cells; rind dots are fewer and larger.`,
  },
};
const wordmarkReference = {
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Diet_Coke_logo.svg',
  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Diet_Coke_logo.svg',
  inspectedAt: '2026-11-15',
  visuallyInspected: true,
  observations: 'Public-domain vector of the 2018 Diet Coke logo (file dated 2017-12-25): heavy serif "Coke" with a small script "Diet" stacked over the k and e. Rendered and compared with the wordmark cropped from the BevNET Ginger Lime photo: the letterforms match; the can sets the two words on one line with "Diet" about 1.7 times larger relative to "Coke", which is how they are placed here. The stacked arrangement is reused only for the small red logo at the foot of the can.',
};

export const records = flavors.map(f => ({
  slug: f.slug,
  family: 'diet-coke-slim-can',
  packageChoice: `US 12 fl oz (355 mL) sleek aluminum can of Diet Coke ${f.flavor}, the package the flavor launched in nationally in January 2018 (singles and eight-packs). Historical: the flavor is no longer sold, and the catalog row names this 2018 line.`,
  references: [{
    pageUrl: 'https://www.bevindustry.com/articles/90846-diet-coke-ginger-lime-feisty-cherry-zesty-blood-orange-twisted-mango',
    imageUrl: evidence[f.slug].imageUrl,
    inspectedAt: '2026-11-15',
    visuallyInspected: true,
    observations: evidence[f.slug].observations,
  }, wordmarkReference],
  uncertainty: evidence[f.slug].uncertainty,
  status: 'needs-review',
  svg: draw(f),
}));
