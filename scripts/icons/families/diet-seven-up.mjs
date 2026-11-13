import { wrap, shadow, ref, text } from '../style.mjs';

const slug = 'diet-seven-up';
const title = '7UP Zero Sugar (Diet 7UP)';
const pageUrl = 'https://www.fredmeyer.com/p/diet-7up/0007800001181';
const imageUrl = 'https://www.kroger.com/product/images/large/front/0007800001181';
const canPath = 'M63 41q37-8 74 0l5 15v166q0 13-42 13t-42-13V56Z';
const label = `<path d="M61 48h78v181H61Z" fill="#10151b"/>${text(77,157,'LIME LEMON',13,'#15a53c','font-weight="900" letter-spacing=".5" textLength="105" lengthAdjust="spacingAndGlyphs" transform="rotate(-90 77 157)"')}${text(112,189,'7UP',60,'#fff','font-weight="900" font-style="italic" letter-spacing="-4" textLength="127" lengthAdjust="spacingAndGlyphs" transform="rotate(-69 111 145)"')}<circle cx="105" cy="165" r="12" fill="#ec303a" stroke="#fff" stroke-width="1.3"/>${text(111,98,'ZERO',12,'#fff','font-weight="900" letter-spacing=".7" transform="rotate(-90 111 98)"')}${text(124,99,'SUGAR',11,'#fff','font-weight="900" letter-spacing=".5" transform="rotate(-90 124 99)"')}${text(100,215,'12 FL OZ',7,'#32b74e','font-weight="bold" letter-spacing=".7"')}`;

const can = `${shadow(55)}<path d="${canPath}" fill="#151a20" stroke="#090c10" stroke-width="1"/><g clip-path="${ref('canclip')}">${label}<path d="${canPath}" fill="${ref('shade')}"/><path d="M69 59v152" stroke="#fff" stroke-opacity=".16" stroke-width="2"/></g><ellipse cx="100" cy="41" rx="37" ry="7" fill="${ref('metal')}" stroke="#7f898c" stroke-width="1"/><ellipse cx="100" cy="41" rx="29" ry="4" fill="none" stroke="#e9ece8" stroke-width="1"/><ellipse cx="105" cy="42" rx="8" ry="3" fill="#505a5d"/><path d="M93 40h11q5 1 3 4t-11 1q-5 0-3-5" fill="none" stroke="#e5e9e6" stroke-width="2"/><path d="M63 222q37 14 74 0" fill="none" stroke="#c9d0d0" stroke-width="3"/>`;

export const records = [{
  slug,
  family: 'diet-soda-can',
  packageChoice: 'Representative US 12 fl oz / 355mL 7UP Zero Sugar can, the current package corresponding to the catalog’s legacy Diet 7UP entry; exact retailer package inspected.',
  references: [{
    pageUrl,
    imageUrl,
    inspectedAt: '2026-11-13',
    visuallyInspected: true,
    observations: 'Exact current US 12oz can inspected: near-black body, very large diagonal white 7UP wordmark with red dot, vertical green LIME LEMON lettering, stacked white ZERO SUGAR at right, green 12 FL OZ footer and silver rims. Retail composite also contains a multipack and lime/lemon garnish; those are not part of the can and were omitted.'
  }],
  uncertainty: 'The catalog uses the name Diet 7Up; current US manufacturer naming and package use 7UP Zero Sugar. The source retains the catalog UUID and documents the current corresponding zero-sugar package. This icon does not claim that historical Diet 7UP packaging looked the same. Original vector interpretation; package revision may vary by region. Final aesthetic approval and web-device review pending.',
  status: 'needs-review',
  svg: wrap(slug, title, can, `<clipPath id="__ID__canclip"><path d="${canPath}"/></clipPath>`)
}];
