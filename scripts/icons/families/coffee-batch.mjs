import {wrap,shadow,ref,text} from '../style.mjs';

// Current manufacturer references; recipes retain exact product/package choices.
const date='2026-11-02';
const evidence=(pageUrl,imageUrl,observations)=>({pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations});

function dunkin(slug,flavor,color,light,dark,tapeText,descriptor) {
  const shape='M80 57H120L118 71Q119 79 130 90Q139 98 139 109L136 188Q136 196 139 209V221Q139 234 100 234T61 221V209Q64 196 64 188L61 109Q61 98 70 90Q81 79 82 71Z';
  const label=`<path d="M60 109h80l-3 77H63Z" fill="#f9f8f1"/>
<path d="M63 175q29 7 51 0 5-6 8-3 2 3 5-1 5-5 10-3v22H63Z" fill="${color}"/>
<path d="M63 151q37 5 74 0" fill="none" stroke="#d0d2cc" stroke-opacity=".4" stroke-width="1.2"/>
${text(100,135,'DUNKIN',17.8,'#f47715','font-weight="bold" letter-spacing="-.8" textLength="76" lengthAdjust="spacingAndGlyphs"')}
${text(135,127,'’',15,'#e13e7c','font-weight="bold"')}
${text(100,147,'ICED COFFEE',9.7,'#dc4e80','font-weight="bold" textLength="66" lengthAdjust="spacingAndGlyphs"')}
${text(99,164,descriptor,3.7,color,'letter-spacing=".7"')}
${text(95,174,flavor,flavor.length>8?7.7:10.5,color,'style="font-family:Georgia,serif;font-weight:bold"')}
<path d="M123 175q-2-9 2-10 6 1 1 7m2 1q4-10 7-6 1 4-7 7" fill="${color}"/>`;
  return wrap(slug,`Dunkin' Bottled Iced Coffee ${flavor}`,`${shadow(49)}
<path d="${shape}" fill="${ref('base')}" stroke="${dark}" stroke-width=".6"/>
<g clip-path="${ref('bodyclip')}">
<path d="M61 76h78v34H61Z" fill="${ref('coffee')}"/>
${label}
<path d="M63 195q37 7 74 0M62 212q38 7 76 0" fill="none" stroke="${dark}" stroke-opacity=".22" stroke-width="2"/>
<path d="M61 198q39 7 78 0M62 213q38 6 76 0" fill="none" stroke="${light}" stroke-opacity=".4" stroke-width="1.2"/>
<path d="${shape}" fill="${ref('shade')}"/>
<path d="M72 94q-6 7-6 15l3 78" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.5"/>
<ellipse cx="82" cy="97" rx="8" ry="7" fill="#fff" opacity=".12"/>
<ellipse cx="119" cy="97" rx="9" ry="7" fill="#fff" opacity=".07"/>
</g>
<path d="M78 25q22-4 44 0l1 28q1 4-3 5H80q-4-1-3-5Z" fill="${ref('base')}" stroke="${dark}" stroke-width=".6"/>
<ellipse cx="100" cy="25" rx="22" ry="3.5" fill="${light}"/>
<path d="M78 48q22 2 44 0M78 55q22 2 44 0" fill="none" stroke="${dark}" stroke-opacity=".28" stroke-width="1.2"/>
<path d="M80 27v18" stroke="#fff" stroke-opacity=".2" stroke-width="1.5"/>
<path d="M95 23h14v39l-14-2Z" fill="${flavor==='original'?'#f5f1e5':'#f47d18'}"/>
<g transform="translate(100.5 43) rotate(90)">${text(0,0,tapeText,tapeText.length>10?3.4:4.8,flavor==='original'?'#e9741a':'#fff9e9','style="font-family:Georgia,serif;font-weight:bold"')}</g>
<path d="M67 227q33 7 66 0" fill="none" stroke="${light}" stroke-opacity=".3" stroke-width="1.4"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath>
<linearGradient id="__ID__base"><stop stop-color="${dark}"/><stop offset=".22" stop-color="${light}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
<linearGradient id="__ID__coffee"><stop stop-color="#9e8466"/><stop offset=".25" stop-color="#c9b396"/><stop offset=".55" stop-color="#bca487"/><stop offset="1" stop-color="#9f866a"/></linearGradient>`);
}

const dove=`<g fill="#183a77">
<path d="M85 154Q102 154 111 166l4-5 4 1 3 3-5 1q-3 10-3 16 4 17-3 29-8-10-9-21-6 7-11 3-4-3-3-9-9 5-16 1 10-5 11-10-8-5-4-9-5-5-4-11Z"/>
<path d="M119 164q2-10 0-18" fill="none" stroke="#183a77" stroke-width=".8"/>
<ellipse cx="117.5" cy="149" rx="1.1" ry="2.4" transform="rotate(-30 117.5 149)"/><ellipse cx="121" cy="153" rx="1.1" ry="2.5" transform="rotate(30 121 153)"/><ellipse cx="118" cy="157" rx="1.1" ry="2.3" transform="rotate(-30 118 157)"/>
</g>`;
function arc(label,color) {
  const chars=[...label], step=70/chars.length;
  return chars.map((char,i)=>{
    const x=100+(i-(chars.length-1)/2)*step;
    const y=128-Math.sin(Math.PI*i/(chars.length-1))*9;
    const angle=(i-(chars.length-1)/2)*5;
    return text(x,y,char,15.1,color,`font-weight="bold" stroke="#203a6c" stroke-width=".7" paint-order="stroke" transform="rotate(${angle} ${x} ${y})"`);
  }).join('');
}
function colombe(slug,flavor,color,{oat=false}={}) {
  const shape='M65 32Q100 24 135 32L141 47V220Q141 233 100 233T59 220V47Z';
  const label=`
<path d="M59 35h82v13H59Z" fill="${color}"/>
${text(100,43,`${oat?'EVERYDAY OAT':flavor} DRAFT LATTE`,4,'#fffdf1','font-weight="bold" letter-spacing=".5"')}
${text(100,69,'La',21,'#173771','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" letter-spacing="-1.5"')}
${text(100.8,88.3,'COLOMBE',18.5,'#e7c665','font-weight="bold" letter-spacing="-.6" textLength="77" lengthAdjust="spacingAndGlyphs"')}
${text(100,87,'COLOMBE',18.5,'#173771','font-weight="bold" letter-spacing="-.6" textLength="77" lengthAdjust="spacingAndGlyphs"')}
${text(100,97,'COFFEE WORKSHOP',5.3,'#173771','font-weight="bold" letter-spacing=".8"')}
${arc(flavor,color)}
${text(100,143,oat?'OAT LATTE':'LATTE',oat?12.9:15.6,color,'font-weight="bold" stroke="#173771" stroke-width=".6" paint-order="stroke"')}
${dove}
${text(74,171,'ESTD',3.6,'#173771','font-weight="bold"')}${text(128,171,'1994',3.6,'#173771','font-weight="bold"')}
${text(100,216,'ESPRESSO ROAST',4.7,'#173771','font-weight="bold" letter-spacing=".4"')}
${text(100,223,oat?'WITH OATMILK':'WITH WHOLE MILK',5.2,'#173771','font-weight="bold" letter-spacing=".5"')}`;
  return wrap(slug,`La Colombe ${flavor} ${oat?'Oat ':''}Draft Latte`,`${shadow(54)}
<path d="${shape}" fill="${ref('canbody')}"/>
<g clip-path="${ref('bodyclip')}">${label}<path d="${shape}" fill="${ref('shade')}" opacity=".7"/>
<path d="M67 52V211" stroke="#fff" stroke-opacity=".22" stroke-width="2.5"/>
${Array.from({length:22},(_,i)=>`<ellipse cx="${65+i*23%69}" cy="${55+i*43%155}" rx="${i%3?.45:.8}" ry="${i%3?.75:1.2}" fill="#fff" opacity=".25"/>`).join('')}
</g>
<ellipse cx="100" cy="32" rx="35" ry="7" fill="${ref('metal')}" stroke="#a4aaa1" stroke-width="1"/>
<ellipse cx="100" cy="32" rx="30" ry="4.7" fill="none" stroke="#8d9892" stroke-width=".6"/>
<ellipse cx="104" cy="33" rx="7" ry="3" fill="#657169"/>
<path d="M94 30h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="#e6e8de" stroke-width="2.2"/>
<path d="M62 226q38 12 76 0" fill="none" stroke="${ref('metal')}" stroke-width="3.5"/>
<path d="M65 230q35 6 70 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__canbody"><stop stop-color="${oat?'#dfd1ab':'#d9d9ce'}"/><stop offset=".23" stop-color="${oat?'#fff2d5':'#fffdf5'}"/><stop offset=".55" stop-color="${oat?'#fbebc9':'#f8f6ef'}"/><stop offset="1" stop-color="${oat?'#e7d9b9':'#deded6'}"/></linearGradient>`);
}

const dunkinPage='https://dunkinanytime.coca-cola.com/products/iced-coffee-on-the-go';
const dunkinImage=flavor=>`https://dunkinanytime.coca-cola.com/content/dam/dunkin/us/en/product-landing-page/teasers/dunkin-iced-${flavor}-product-img.png`;
const record=(slug,family,packageChoice,reference,svg,uncertainty='')=>({slug,family,packageChoice,references:[reference],uncertainty:`${uncertainty} Package lettering, illustrations and fine print simplified as original vectors; final aesthetic approval and native-device review pending.`.trim(),status:'needs-review',svg});
export const records=[
  record('dunkin-bottled-iced-coffee-original','dunkin-pet-coffee-bottle','US 13.7 fl oz Original Dunkin bottled iced coffee, orange screw cap and orange/white shrink label.',evidence(dunkinPage,dunkinImage('original'),'Manufacturer Original image inspected: stout curved PET bottle, visible tan coffee shoulders, orange screw cap/neck and lower bottle sleeve, white vertical cap strip with orange original; white middle label with orange DUNKIN and pink apostrophe, pink ICED COFFEE, orange original and small RICH + SMOOTH. Waist and lower-body molded rings visible.'),dunkin('dunkin-bottled-iced-coffee-original','original','#ee7618','#ff983d','#c05b0d','original','RICH + SMOOTH')),
  record('dunkin-bottled-iced-coffee-mocha','dunkin-pet-coffee-bottle','US 13.7 fl oz Mocha Dunkin bottled iced coffee, brown cap and brown/white sleeve.',evidence(dunkinPage,dunkinImage('mocha'),'Separate manufacturer Mocha image inspected: same stout contoured PET bottle with exposed tan coffee shoulders; chocolate-brown cap, neck and lower sleeve; orange vertical cap strip with white mocha; white central label, orange DUNKIN/pink apostrophe, pink ICED COFFEE, brown mocha and RICH + CHOCOLATEY. Lower sleeve brown rather than Original orange or Vanilla gold.'),dunkin('dunkin-bottled-iced-coffee-mocha','mocha','#714335','#996b58','#45291f','mocha','RICH + CHOCOLATEY')),
  record('dunkin-bottled-iced-coffee-french-vanilla','dunkin-pet-coffee-bottle','US 13.7 fl oz French Vanilla Dunkin bottled iced coffee, pale gold cap and gold/white sleeve.',evidence(dunkinPage,dunkinImage('french-vanilla'),'Separate manufacturer French Vanilla image inspected: same contoured bottle and tan coffee shoulder; pale gold cap/neck and lower sleeve, orange vertical cap strip with white French vanilla; white middle label with orange DUNKIN, pink ICED COFFEE, gold french vanilla and CREAMY + SMOOTH. Flavor lettering is two words and gold, unlike brown Mocha.'),dunkin('dunkin-bottled-iced-coffee-french-vanilla','french vanilla','#d2a45e','#f0d39d','#b98b46','French vanilla','CREAMY + SMOOTH')),
  record('la-colombe-draft-latte-original','la-colombe-draft-latte-can','US 9 fl oz unflavored whole-milk Everyday Draft Latte can, explicitly selected as representative plain dairy Draft Latte for the size-unspecified Original catalog row; not Triple or flavored latte.',evidence('https://www.lacolombe.com/products/draft-latte','https://www.lacolombe.com/cdn/shop/files/LC_DTC_9oz_EVERYDAY_USSF.png_2.png?v=1774633181&width=1200','Manufacturer current plain dairy can inspected: white/cream slim 9oz can with silver rims, gold shoulder band, navy La COLOMBE with gold offset, COFFEE WORKSHOP, arched gold EVERYDAY above LATTE, navy dove holding olive branch, ESPRESSO ROAST / WITH WHOLE MILK low on face. Selected image includes US Soccer badge; badge and tiny text omitted.'),colombe('la-colombe-draft-latte-original','EVERYDAY','#e8b563'),'Catalog says Original; manufacturer currently titles the selected unflavored product Everyday. This records the representative package choice without claiming a historical formula or label equivalence.'),
  record('la-colombe-draft-latte-mocha','la-colombe-draft-latte-can','US 9 fl oz La Colombe Mocha Draft Latte can, current manufacturer white/navy/brown package.',evidence('https://www.lacolombe.com/products/mocha-draft-latte','https://www.lacolombe.com/cdn/shop/files/mocha_cutout_gallery.png?v=1774638953&width=1200','Separate manufacturer Mocha can inspected: cream/white slim 9oz can, brown shoulder band, navy La COLOMBE with gold offset and COFFEE WORKSHOP; arched brown MOCHA, brown LATTE, navy dove/olive branch below; ESPRESSO ROAST / WITH WHOLE MILK at base. Different from blue Vanilla or gold plain can.'),colombe('la-colombe-draft-latte-mocha','MOCHA','#6b473f')),
  record('la-colombe-draft-latte-vanilla','la-colombe-draft-latte-can','US 9 fl oz La Colombe Vanilla Draft Latte can, current white/navy/blue manufacturer package.',evidence('https://www.lacolombe.com/products/vanilla-draft-latte','https://www.lacolombe.com/cdn/shop/files/vanilla_cutout_gallery.png?v=1774638959&width=1200','Separate manufacturer Vanilla can inspected: cream/white slim 9oz can, bright blue shoulder band, navy La COLOMBE with gold offset and COFFEE WORKSHOP; arched blue VANILLA and blue LATTE with navy outline, navy dove/olive branch and WITH WHOLE MILK low on face; silver rims.'),colombe('la-colombe-draft-latte-vanilla','VANILLA','#75a9eb')),
  record('la-colombe-draft-latte-oat-milk','la-colombe-draft-latte-can','US 9 fl oz La Colombe Oatmilk Everyday Draft Latte; explicitly selected unflavored oatmilk variant for the Oat Milk catalog row, not Oatmilk Vanilla.',evidence('https://www.lacolombe.com/products/oatmilk-draft-latte','https://www.lacolombe.com/cdn/shop/files/oat_everyday_cutout_gallery.png?v=1774638960&width=1200','Separate manufacturer Oatmilk Everyday image inspected: pale cream/yellow slim can, gold shoulder band reading EVERYDAY OAT DRAFT LATTE, navy La COLOMBE and COFFEE WORKSHOP; arched gold EVERYDAY and OAT LATTE with navy outline, navy dove/olive branch, ESPRESSO ROAST / WITH OATMILK low on face, silver rims. Oatmilk package is cream/yellow rather than white dairy version.'),colombe('la-colombe-draft-latte-oat-milk','EVERYDAY','#e6b569',{oat:true}),'Selected current unflavored Everyday Oat Latte rather than a flavored oatmilk variant; catalog does not specify a packaging revision.'),
];
