import { wrap, shadow, ref, text } from '../style.mjs';

const bottlePath = 'M84 57h32l2 20q9 5 12 15l4 14q2 13-13 22-8 6-7 15 17 4 22 20v60q0 16-17 17H81q-17-1-17-17v-60q5-16 22-20 1-9-7-15-15-9-13-22l4-14q3-10 12-15Z';
const glassDefs = `<linearGradient id="__ID__glassbody"><stop stop-color="#aecbd0" stop-opacity=".6"/><stop offset=".17" stop-color="#f8ffff" stop-opacity=".3"/><stop offset=".5" stop-color="#d8eef0" stop-opacity=".12"/><stop offset=".82" stop-color="#bad8dc" stop-opacity=".28"/><stop offset="1" stop-color="#77999b" stop-opacity=".48"/></linearGradient><clipPath id="__ID__bottleclip"><path d="${bottlePath}"/></clipPath><pattern id="__ID__bluecheck" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0h7v7H0Z" fill="#f4fbf6"/><path d="M0 0h3v3H0Zm3 3h4v4H3Z" fill="#69c4dc"/></pattern><pattern id="__ID__greencheck" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0h8v8H0Z" fill="#b5d94a"/><path d="m0 0 8 8M8 0 0 8" stroke="#d7ef83" stroke-width=".8" opacity=".75"/></pattern>`;

const cap = `<path d="M82 23q18-5 36 0l-1 37q0 4-5 4H88q-5 0-5-4Z" fill="#f7f6ee" stroke="#c6cbc0" stroke-width=".7"/><path d="M84 25q16-3 32 0M84 30h32M84 34h32" stroke="#e54b56" stroke-width="1.6"/>${text(100,46,'HATA',10,'#cc3c49','font-weight="900" letter-spacing=".4"')}${text(100,53,'KOSEN',4,'#a4353c','font-weight="bold"')}`;

function glassBody(liquid) {
  return `${shadow(42)}<path d="${bottlePath}" fill="${ref('glassbody')}" stroke="#9eb8ba" stroke-width="1.1"/><g clip-path="${ref('bottleclip')}"><path d="M66 156h68v81H66Z" fill="${liquid}" opacity=".42"/><path d="M81 79q-8 17-4 28t13 13q4 9 1 22" fill="none" stroke="#fff" stroke-opacity=".72" stroke-width="3"/><path d="M119 79q8 17 4 28t-13 13q-4 9-1 22" fill="none" stroke="#78999b" stroke-opacity=".5" stroke-width="2"/><circle cx="100" cy="101" r="15" fill="#eafaff" fill-opacity=".43" stroke="#8ebac0" stroke-opacity=".8" stroke-width="1.1"/><ellipse cx="94" cy="95" rx="5" ry="2.5" fill="#fff" opacity=".68"/><path d="M67 164v59q0 12 12 13M133 164v59q0 12-12 13" fill="none" stroke="#fff" stroke-opacity=".57" stroke-width="2"/></g>${cap}<path d="M68 231q32 8 64 0" fill="none" stroke="#86a4a5" stroke-width="1"/>`;
}

function originalGlyph() {
  // A simplified red brush flourish echoes the oversized calligraphic mark on
  // the verified export package without pretending to reproduce legal copy.
  return `<path d="M81 174q11-19 25-14 9 4-1 14-8 8-14 22 9-10 22-18 8-6 13-4-8 12-18 24-9 11-16 17m-8-12q18-3 36 5m-22-26 16 24" fill="none" stroke="#d92134" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M74 159q4-5 8-7m37 67 6 1" stroke="#e55756" stroke-width="1.5"/>`;
}

const refs = {
  'ramune-original': {
    pageUrl: 'https://lafrikileria.com/es/comida-japonesa-online/46166-ramune-sabor-original-hata-kosen-200-ml-4902494008004.html',
    imageUrl: 'https://lafrikileria.com/156981-large_default/ramune-sabor-original-hata-kosen-200-ml.jpg',
    observations: 'Exact Hata Kosen 200mL export bottle inspected: clear Codd-neck glass with bulb chamber and narrow waist, white sealed cap printed with red HATA, pale cyan drink, blue checker wrap, large red calligraphic label mark, small yellow vertical block and Hata Kosen footer. Retail background omitted; fine Japanese/legal copy simplified.',
    jan: '4902494008004', catalogName: 'Ramune'
  },
  'ramune-melon': {
    pageUrl: 'https://www.worldofsweets.de/Hata-Kosen-Ramune-Melon-200ml.335621.html',
    imageUrl: 'https://www.worldofsweets.de/out/pictures/master/product/1/hatakosen-ramune-melon-200ml-no1-5434.jpg',
    observations: 'Exact Hata Kosen Melon 200mL bottle image inspected: clear Codd-neck glass, white cap with red HATA, vivid green checker label, white HATA outlined green, vertical melon Ramune lettering with yellow and white outlines, pale apple-green drink and small smiling netted melons. Retail background omitted; fine Japanese/legal copy simplified.',
    jan: '4902494090177', catalogName: 'Ramune Melon Flavor'
  }
};

function record(slug, title, flavor, label, liquid) {
  const evidence = refs[slug];
  return {
    slug,
    family: 'ramune-codd-neck-glass',
    packageChoice: `Representative Japanese export Hata Kosen 200mL glass bottle of ${title}; exact package individually inspected.`,
    references: [
      { pageUrl: evidence.pageUrl, imageUrl: evidence.imageUrl, inspectedAt: '2026-11-12', visuallyInspected: true, observations: evidence.observations },
      { pageUrl: 'https://pub-mediabox-storage.rxweb-prd.com/exhibitor/document/exh-e56f0e5d-8b58-4fff-86e9-aa20c0e27686/d4fad4e5-cb96-4e6d-9c93-25897f6a79f8.pdf', imageUrl: 'https://pub-mediabox-storage.rxweb-prd.com/exhibitor/document/exh-e56f0e5d-8b58-4fff-86e9-aa20c0e27686/d4fad4e5-cb96-4e6d-9c93-25897f6a79f8.pdf', inspectedAt: '2026-11-12', visuallyInspected: true, observations: `Hata Kosen manufacturer catalog lists ${evidence.catalogName}, 200mL glass bottle, JAN ${evidence.jan}. Product name and barcode corroborate brand/flavor identity.` }
    ],
    uncertainty: `Catalog flavor recorded as ${flavor}; manufacturer Hata Kosen product catalog lists the corresponding 200mL SKU. Exact export package depicted; regional label revisions may vary. Original vector simplification, not an exact label reproduction. A different Kimura 410mL Melon Ramune package was rejected as the wrong brand. Final aesthetic approval and web-device review pending.`,
    status: 'needs-review',
    svg: wrap(slug, title, `${glassBody(liquid)}<g clip-path="${ref('bottleclip')}"><path d="M65 155q35-5 70 0v78H65Z" fill="${label}" stroke="#f5faf0" stroke-width="1"/><path d="M65 155q35-5 70 0v78H65Z" fill="${ref(slug === 'ramune-original' ? 'bluecheck' : 'greencheck')}" opacity=".8"/><path d="M69 168q31-6 62 0v9q-31-6-62 0Z" fill="${slug === 'ramune-original' ? '#e9f5f3' : '#8fc63f'}"/>${text(100,176,'HATA',11,slug === 'ramune-original' ? '#2c76a7' : '#fffdf0','font-weight="900" stroke="'+(slug === 'ramune-original' ? '#fff' : '#226b35')+'" stroke-width=".7" paint-order="stroke"')}${slug === 'ramune-original' ? originalGlyph() : `<g fill="#238641" stroke="#eff6c7" stroke-width=".8"><ellipse cx="77" cy="196" rx="8" ry="10"/><path d="M71 192q7-9 14-2l-1 8q-7 6-13-1Z"/><ellipse cx="123" cy="207" rx="7" ry="9"/><path d="M117 204q6-8 12-1l-1 7q-6 5-11-1Z"/></g><path d="M74 195q3-3 6 0m40 7q3-3 6 0" stroke="#172e22" stroke-width="1.2" fill="none"/>${text(102,204,'RAMUNE',8,'#fffbe7','font-weight="900" stroke="#218443" stroke-width="2.2" paint-order="stroke" textLength="53" lengthAdjust="spacingAndGlyphs" transform="rotate(90 102 204)"')}${text(78,214,'MELON',4.2,'#fffbe7','font-weight="bold" letter-spacing=".6" transform="rotate(-90 78 214)"')}`}${text(100,227,'HATA KOSEN',4.3,slug === 'ramune-original' ? '#2879a3' : '#fffbe7','font-weight="bold" letter-spacing=".5"')}</g>`, glassDefs)
  };
}

export const records = [
  record('ramune-original', 'Hata Kosen Ramune Original', 'Original', '#eef9f6', '#b6e5ed'),
  record('ramune-melon', 'Hata Kosen Ramune Melon', 'Melon', '#a7d83f', '#b4db68')
];
