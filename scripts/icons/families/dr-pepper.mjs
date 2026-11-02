import {wrap, shadow, ref, text} from '../style.mjs';

// Individually inspected US retailer packshots; football-season packaging.
// Preserve the pilot can geometry and light direction without modifying it.
const shape = 'M61 41Q100 32 139 41L145 58V220Q145 233 100 233T55 220V58Z';
function draw(slug, diet, zero = false) {
  const ink = diet ? '#8d2339' : '#fff9ef';
  const burgundy = '#982c43';
  const lettering = 'style="font-family:Georgia,serif;font-style:italic;font-weight:bold" letter-spacing="-2.5"';
  const label = `
${zero ? `<path d="M55 35h90v32H55Z" fill="${burgundy}"/><path d="M55 35h90v32H55Z" fill="${ref('dots')}"/>\n` : ''}<path d="M55 55h90v12H55ZM55 211h90v12H55Z" fill="${burgundy}"/>
<path d="M55 55h90v12H55ZM55 211h90v12H55Z" fill="${ref('dots')}"/>
${diet ? '' : zero ? `<path d="M55 68h90v76L92 85Z" fill="${burgundy}"/><path d="M55 68h90v76L92 85Z" fill="${ref('dots')}" opacity=".6"/><path d="M55 67h90v10H55ZM55 211h90v8H55Z" fill="${ref('metal')}"/>` : `<path d="M55 68h90v142H55Z" fill="${ref('dots')}" opacity=".6"/><path d="M55 67h90v10H55ZM55 211h90v8H55Z" fill="${ref('metal')}"/>`}
${zero ? '<path d="M55 219h90v15H55Z" fill="#111617"/>\n' : ''}<g transform="rotate(-13 100 118)">
<ellipse cx="100" cy="113" rx="43" ry="28" fill="${diet ? '#e7e7e3' : burgundy}"/>
<path d="M65 132C39 104 79 80 112 84M119 85C163 97 146 132 93 140" fill="none" stroke="${ink}" stroke-width="1.5"/>
${text(104, 107, 'Dr', 30, ink, lettering)}
${text(98, 130, 'Pepper', 31, ink, `${lettering} textLength="78" lengthAdjust="spacingAndGlyphs"`)}
${text(123, 140, 'Est.1885', 4.8, ink, 'style="font-family:Georgia,serif;font-weight:bold"')}
</g>
${zero ? `${text(100,170,'zero',25,ink,'font-weight="bold" letter-spacing="-.5"')}${text(100,183,'SUGAR',14,ink,'font-weight="bold" letter-spacing=".6"')}` : `<g transform="rotate(-12 100 162)">
<ellipse cx="100" cy="162" rx="23" ry="16" fill="none" stroke="${ink}" stroke-width="1.4"/>
${diet ? text(100, 168, 'Diet', 19, ink, 'style="font-family:Georgia,serif;font-style:italic;font-weight:bold" letter-spacing="-1"') : `<ellipse cx="100" cy="162" rx="20" ry="13" fill="none" stroke="${ink}" stroke-width=".5"/>${text(100, 169, '23', 22, ink, 'font-style="italic" font-weight="bold"')}`}
</g>`}
<g transform="translate(119 81) rotate(17)" fill="none" stroke="${ink}" stroke-width=".8">
<ellipse rx="8" ry="5"/><path d="M-5-4v8M5-4v8M-3 0h6M-2-2v4M0-2v4M2-2v4"/>
</g>
${text(100, 204, '12 FL OZ', 10, ink, 'font-weight="bold" letter-spacing=".6"')}`;
  return wrap(slug, zero ? 'Dr Pepper Zero Sugar' : diet ? 'Diet Dr Pepper' : 'Dr Pepper', `${shadow(58)}
<path d="${shape}" fill="${zero ? '#111617' : diet ? ref('silver') : burgundy}"/>
<g clip-path="${ref('bodyclip')}">${label}
<path d="${shape}" fill="${ref('shade')}" opacity=".85"/>
<path d="M65 62V213" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="3.1"/>
<path d="M138 62V213" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="1.3"/>
</g>
<ellipse cx="100" cy="41" rx="39" ry="8" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="41" rx="34" ry="5.5" fill="none" stroke="#8d9892" stroke-width=".8"/>
<ellipse cx="105" cy="42" rx="8" ry="3.5" fill="#657169"/>
<path d="M93 39h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="#e6e8de" stroke-width="2.4"/>
<path d="M58 226q42 12 84 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M61 230q39 7 78 0" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath>
<pattern id="__ID__dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#461c2c" opacity=".65"/><circle cx="3" cy="3" r=".65" fill="#461c2c" opacity=".65"/></pattern>
${diet ? '<linearGradient id="__ID__silver"><stop stop-color="#acafb2"/><stop offset=".23" stop-color="#f3f2ee"/><stop offset=".52" stop-color="#e5e5e2"/><stop offset=".85" stop-color="#b2b2b5"/><stop offset="1" stop-color="#dcdddd"/></linearGradient>' : ''}`);
}

function record(slug, diet, upc, observations) {
  return {
    slug, family: 'dr-pepper-can',
    packageChoice: `US 12 fl oz / 355mL ${diet ? 'Diet Dr Pepper' : 'Dr Pepper Original'} aluminum can with football-season package graphics; representative size for the size-unspecified catalog row.`,
    references: [{
      pageUrl: `https://www.kroger.com/p/${diet ? 'diet-' : ''}dr-pepper-soda-cans/${upc}`,
      imageUrl: `https://www.kroger.com/product/images/large/front/${upc}`,
      inspectedAt: '2026-11-02', visuallyInspected: true, observations,
    }],
    uncertainty: 'Manufacturer products page rejected direct retrieval (403); used individually inspected retailer packshots. Seasonal football graphics are retained as observed. Brand lettering is a simplified pinned-font vector interpretation; small ring text and side-panel print omitted. Final aesthetic approval and native-device review pending.',
    status: 'needs-review', svg: draw(slug, diet),
  };
}

export const records = [
  {
    slug:'dr-pepper-zero-sugar',family:'dr-pepper-can',
    packageChoice:'US 12 fl oz / 355mL Dr Pepper Zero Sugar can, burgundy/black football-season package; representative US size for the size-unspecified catalog row.',
    references:[{pageUrl:'https://www.kroger.com/p/dr-pepper-zero-sugar-soda-cans/0007800003526',imageUrl:'https://www.kroger.com/product/images/large/front/0007800003526',inspectedAt:'2026-11-02',visuallyInspected:true,observations:'Independently inspected Zero Sugar packshot: black main face, burgundy halftone neck and upper-right diagonal area, burgundy oval with white Dr Pepper script/Est.1885 and football, white lowercase zero over uppercase SUGAR below, white 12 FL OZ, silver shoulder/base strips and rims. Unlike Original, black lower body and Zero Sugar lockup; unlike Diet, no silver main face or Diet oval.'}],
    uncertainty:'Manufacturer products page had no retrievable package artwork; retailer reference selected. Simplified pinned-font brand lettering and seasonal football detail; tiny side-panel print omitted. Final aesthetic approval and native-device review pending.',
    status:'needs-review',svg:draw('dr-pepper-zero-sugar',false,true),
  },
  record('dr-pepper', false, '0007800008216', 'Retailer packshot visually inspected: standard can with burgundy halftone body, silver horizontal shoulder and base bands, large white diagonal two-line Dr Pepper lettering and oval swooshes, small Est.1885, white 23 oval below, small outlined football above-right, white 12 FL OZ at base; silver lid and foot. Original variant confirmed by product page.'),
  record('diet-dr-pepper', true, '0007800008316', 'Separate Diet retailer packshot visually inspected: silver/white can with burgundy halftone shoulder and base strips; burgundy diagonal Dr Pepper lettering, swooshes and small Est.1885; Diet in burgundy outlined oval below, small football above-right and burgundy 12 FL OZ at base. Diet has a silver main face, unlike the burgundy Original; silver lid and foot.'),
];
