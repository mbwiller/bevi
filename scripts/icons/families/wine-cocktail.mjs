import { wrap, shadow, ref, text } from '../style.mjs';

// Closed 750mL DOC bottle, proportioned from the manufacturer's front packshot.
const bottle = 'M89 19Q100 16 111 19L112 71C113 92 125 113 131 136Q137 155 137 179L134 220Q140 229 135 233Q100 241 65 233Q60 229 66 220L63 179Q63 155 69 136C75 113 87 92 88 71Z';
const crown = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="#566361" stroke-width=".65"><path d="m-9 0 2 6h14l2-6-5 3-4-6-4 6Zm2 8H7M-4 10H4M-12 8q-6 4-8 0m32 0q6 4 8 0"/><circle cy="-5" r="1.2"/><circle cx="-10" cy="-1" r=".9"/><circle cx="10" cy="-1" r=".9"/><path d="M-1-8h2m-1-1v3"/></g>`;
const foilTexture = Array.from({ length: 20 }, (_, row) => Array.from({ length: 8 }, (_, col) => {
  const x = 89.5 + col * 2.7 + (row % 2 ? 1 : 0);
  const y = 24 + row * 1.8;
  return `<path d="m${x} ${y} .7 .9-.7 .8-.7-.8Z" fill="${col < 3 ? '#f4f5ed' : '#68746e'}" opacity=".32"/>`;
}).join('')).join('');

const prosecco = wrap('la-marca-prosecco', 'La Marca Prosecco', `
${shadow(47)}
<path d="${bottle}" fill="${ref('wineglass')}" stroke="#44605b" stroke-width=".7"/>
<path d="M87 78C84 105 72 126 70 148Q65 171 69 218" fill="none" stroke="#cfebe4" stroke-opacity=".22" stroke-width="3.3"/>
<path d="M114 83C116 105 130 134 131 156L130 216" fill="none" stroke="#b8e4dd" stroke-opacity=".2" stroke-width="1.5"/>
<path d="M68 221q32 9 64 0l3 10q-35 9-70 0Z" fill="${ref('base')}"/>
<path d="M66 230q34 9 68 0" stroke="#87a69c" stroke-opacity=".42" stroke-width="1.7" fill="none"/>
<path d="M70 163q30 1.5 60 0l-2 51q-28 3-56 0Z" fill="${ref('label')}"/>
<path d="M74 167q26 1 52 0l-1.5 43q-24.5 2-49 0Z" stroke="#819f9e" stroke-width=".55" fill="none"/>
<path d="M75.5 168.5q24.5 1 49 0l-1.4 40q-23.1 2-46.2 0Z" stroke="#93afae" stroke-width=".25" fill="none"/>
${crown(100, 177, .57)}
${text(100, 190, 'LAMARCA', 10.2, '#223c46', 'style="font-family:Times New Roman,serif" letter-spacing="-.5"')}
${text(100, 197, 'PROSECCO', 5.5, '#253d43', 'style="font-family:Times New Roman,serif" letter-spacing="1.3"')}
${text(100, 201.5, 'D.O.C.', 2.5, '#354c4e', 'letter-spacing=".6"')}
${text(100, 205.5, 'SPARKLING WINE', 2.1, '#354c4e', 'letter-spacing=".65"')}
<path d="M87 21Q100 17 113 21l-1 6 1 5-1 8 1 6-2 17H89l-1-17 1-6-1-8 1-5Z" fill="${ref('foil')}"/>
<ellipse cx="100" cy="21" rx="12.4" ry="2.6" fill="#d9ded4"/>
${foilTexture}
<path d="m89 25 3 9-2 7 2 8-1 12m19-36-2 10 3 7-2 8 1 8" stroke="#e7eae0" stroke-width=".8" opacity=".6" fill="none"/>
<path d="M88.6 62h22.8l1 17q-12.4 2-24.8 0Z" fill="${ref('label')}"/>
<path d="M89 64h22M88 77q12 1.8 24 0" stroke="#799ea2" stroke-width=".65" fill="none"/>
${crown(100, 68, .35)}
`, `<linearGradient id="__ID__wineglass"><stop stop-color="#183b38"/><stop offset=".12" stop-color="#3d5551"/><stop offset=".28" stop-color="#343e36"/><stop offset=".56" stop-color="#242820"/><stop offset=".85" stop-color="#192e2b"/><stop offset="1" stop-color="#46645e"/></linearGradient>
<linearGradient id="__ID__label"><stop stop-color="#a1d7df"/><stop offset=".25" stop-color="#b7e5e9"/><stop offset=".7" stop-color="#a5d4dd"/><stop offset="1" stop-color="#81afbb"/></linearGradient>
<linearGradient id="__ID__foil"><stop stop-color="#9ca79f"/><stop offset=".22" stop-color="#e1e4dc"/><stop offset=".5" stop-color="#c7cdc3"/><stop offset=".8" stop-color="#929e95"/><stop offset="1" stop-color="#c7cdc3"/></linearGradient>
<linearGradient id="__ID__base" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#25332d"/><stop offset=".5" stop-color="#53665b"/><stop offset=".76" stop-color="#1c322f"/><stop offset="1" stop-color="#2c4841"/></linearGradient>`);

// Generic catalog identity: a representative classic on-the-rocks serving.
// Use a settled drink, without the promotional reference photograph's splash.
const glass = 'M43 86Q100 66 157 86L153 216Q153 236 100 237Q47 236 47 216Z';
const ice = (x, y, angle, w = 30, h = 29) => `<g transform="translate(${x} ${y}) rotate(${angle})"><rect width="${w}" height="${h}" rx="5" fill="${ref('ice')}" stroke="#fffef0" stroke-opacity=".65" stroke-width=".9"/><path d="M4 ${h - 5} 4 7Q4 4 7 4h${w - 14}" fill="none" stroke="#fffef5" stroke-opacity=".7" stroke-width="1.3"/><path d="m5 ${h - 3} ${w - 9} -2" stroke="#b3c3b1" stroke-opacity=".25" fill="none"/></g>`;
const salt = Array.from({ length: 74 }, (_, i) => {
  const t = Math.PI * 2 * i / 74;
  const x = 100 + 56.3 * Math.cos(t), y = 86 + 10.2 * Math.sin(t);
  const n = (i * 17 % 7) / 7;
  return `<rect x="${(x - .6).toFixed(2)}" y="${(y - .6 + n).toFixed(2)}" width="${(1 + n).toFixed(2)}" height="${(.9 + n).toFixed(2)}" rx=".2" fill="${i % 3 ? '#fffef6' : '#d4d8c7'}" transform="rotate(${i * 31 % 90} ${x.toFixed(2)} ${y.toFixed(2)})"/>`;
}).join('');
const margarita = wrap('generic-margarita', 'Margarita', `
${shadow(65)}
<path d="${glass}" fill="${ref('glass')}" stroke="#a8b8b0" stroke-opacity=".75" stroke-width="1"/>
<path d="M47 102Q100 88 153 102L149 211Q149 223 100 224Q51 223 51 211Z" fill="${ref('citrus')}"/>
<ellipse cx="100" cy="102" rx="53" ry="10" fill="#e8e9cc" fill-opacity=".85"/>
<g clip-path="${ref('drinkClip')}">
${ice(57, 107, -12, 31, 37)}${ice(105, 103, 13, 34, 31)}${ice(83, 138, 19, 36, 38)}${ice(119, 154, -12, 26, 33)}${ice(58, 181, -8, 31, 26)}
<path d="M50 156q50 15 101 0v57q-51 20-101 0Z" fill="#f0ecd0" opacity=".27"/>
</g>
${ice(70, 83, -13, 32, 26)}${ice(110, 88, 17, 26, 28)}
<path d="M48 105 52 213q1 17 48 18t48-18l4-108" fill="none" stroke="#fffef6" stroke-opacity=".66" stroke-width="2.2"/>
<path d="M55 115v73" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
<path d="M146 114 144 199" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>
<path d="M49 217q51 17 102 0l-.8 9q-50.2 15-100.4 0Z" fill="${ref('glassbase')}"/>
<path d="M52 228q48 12 96 0" fill="none" stroke="#fafff5" stroke-opacity=".85" stroke-width="1.6"/>
<ellipse cx="100" cy="86" rx="57" ry="10.8" fill="none" stroke="#eff7eb" stroke-width="2.3"/>
<path d="M44 87q56 20 112 0" fill="none" stroke="#b4c5b8" stroke-opacity=".42" stroke-width=".8"/>
${salt}
<g transform="translate(146 77) rotate(28)">
<path d="M0-28C-15-23-23-3-15 20Q1 24 12 12C3-1 2-15 0-28Z" fill="#467d24" stroke="#416d2b" stroke-width=".7"/>
<path d="M0-26C-12-19-18-2-12 16Q-1 20 9 11C1-1 1-15 0-26Z" fill="#e2e7b0"/>
<path d="M-1-22C-11-15-15-1-10 12Q-2 16 5 10C0-1 0-13-1-22Z" fill="${ref('lime')}"/>
<path d="M5 10-5-18M5 10-11-10M5 10-13-1M5 10-11 8" stroke="#f4f1c7" stroke-width="1" opacity=".85" fill="none"/>
<path d="m-6-9 2 3m-5 3 4 3m-3 4 4 2m-1 5 4 1" stroke="#f6f1c7" stroke-width=".45" opacity=".7" fill="none"/>
<path d="M-18 3q-1 9 3 16" stroke="#7aa449" stroke-width="1.4" fill="none"/>
</g>
`, `<linearGradient id="__ID__citrus"><stop stop-color="#cbd1b4" stop-opacity=".88"/><stop offset=".25" stop-color="#eeecd0" stop-opacity=".93"/><stop offset=".65" stop-color="#e3e3c5" stop-opacity=".9"/><stop offset="1" stop-color="#c0ccb1" stop-opacity=".95"/></linearGradient>
<linearGradient id="__ID__ice" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffef2" stop-opacity=".65"/><stop offset=".45" stop-color="#fbfced" stop-opacity=".28"/><stop offset="1" stop-color="#b8c9b5" stop-opacity=".28"/></linearGradient>
<linearGradient id="__ID__glassbase" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".7"/><stop offset=".5" stop-color="#9daea2" stop-opacity=".38"/><stop offset="1" stop-color="#eff8e8" stop-opacity=".7"/></linearGradient>
<linearGradient id="__ID__lime"><stop stop-color="#9fbf5c"/><stop offset=".6" stop-color="#d8df95"/><stop offset="1" stop-color="#bacf75"/></linearGradient>
<clipPath id="__ID__drinkClip"><path d="M47 102H153L149 211Q149 223 100 224Q51 223 51 211Z"/></clipPath>`);

export const records = [
  {
    slug: 'la-marca-prosecco', family: 'sparkling-wine-bottle',
    packageChoice: 'US-market 750mL La Marca Prosecco DOC; closed dark-glass bottle with silver foil and pale-blue labels.',
    references: [{
      pageUrl: 'https://www.lamarcaprosecco.com/prosecco.html',
      imageUrl: 'https://www.lamarcaprosecco.com/dw/image/v2/bfwt_prd/on/demandware.static/-/Sites-lamarca-Library/default/dw0dba4f73/pdp/Ref2026/LAM-DemiSec-DOC.png?q=65&sh=1000&sm=fit&sw=1000',
      inspectedAt: '2026-10-27', visuallyInspected: true,
      observations: 'Manufacturer flagship DOC page packshot inspected: tall narrow dark green bottle, long sloped shoulders, silver textured foil, pale turquoise neck band and rectangular lower label, small crown and dark serif LAMARCA / PROSECCO. Image filename contains DemiSec, but visible front label and linked product page identify flagship Prosecco DOC; no Demi Sec wording is drawn.'
    }],
    uncertainty: 'Representative 750mL package selected because catalog omits size. Fine foil texture and crown are simplified. Manufacturer image filename discrepancy recorded; final aesthetic/native review pending.',
    status: 'needs-review', svg: prosecco,
  },
  {
    slug: 'generic-margarita', family: 'served-rocks-cocktail',
    packageChoice: 'Unbranded classic margarita on ice in a clear straight-sided lowball, salted rim and lime garnish; representative serving, not frozen.',
    references: [{
      pageUrl: 'https://www.cointreau.com/us/en/cocktails/margarita',
      imageUrl: 'https://brandcenter.remy-cointreau.com/transform/01af6ff1-44f9-4082-9952-5937a4e258af/C0257_margarita_lifestyle.png?format=webp&io=transform%3Afill%2Cwidth%3A1560%2Cheight%3A1560%2Cgravity%3Acenter&source=Large',
      inspectedAt: '2026-10-27', visuallyInspected: true,
      observations: 'Inspected cocktail-maker reference photograph: clear cylindrical lowball with thick transparent base, cloudy pale straw drink, ice, crystalline salt rim and green lime garnish at upper right. Promotional splash omitted for a settled serving. Page explicitly describes an on-the-rocks lowball preparation.'
    }],
    uncertainty: 'Generic catalog beverage has no unique glass or recipe. This is one documented classic serving; no brand mark, frozen texture or bright-green syrup is inferred. Final aesthetic/native review pending.',
    status: 'needs-review', svg: margarita,
  },
];
