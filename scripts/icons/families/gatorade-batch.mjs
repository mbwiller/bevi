import {wrap,shadow,ref,text} from '../style.mjs';

// Each variant was inspected independently. Fruit Punch retains its photographed
// older lower label; the other references show Advanced/Zero Sugar Rehydration.
const shape='M82 40H118V52C118 60 139 68 143 88L144 100 140 108 142 117 138 139 135 151 133 166 135 182 140 201 139 211 136 216 142 223V231Q100 240 58 231V223L64 216 61 211 60 201 65 182 67 166 65 151 62 139 58 117 60 108 56 100 57 88C61 68 82 60 82 52Z';
const liquid=(key,color,light,dark)=>`<linearGradient id="__ID__${key}"><stop stop-color="${dark}"/><stop offset=".24" stop-color="${light}"/><stop offset=".52" stop-color="${color}"/><stop offset=".85" stop-color="${dark}"/><stop offset="1" stop-color="${color}"/></linearGradient>`;
const person=`<g transform="translate(70 192) scale(.48)" fill="#464e43" stroke="#e6e9d6" stroke-width=".8"><path d="M5-3 11-12 17-9 20-3 15 1 18 6 25 10 22 14 13 11 10 20 15 29 9 43 1 43 4 26-1 19-5 28-12 25-7 12-2 4Z"/><path d="M17-8 24-12 32-2 38 8 35 13 23 18 20 13 30 9 24 2 20 3Z"/><path d="m15-11 6-7 8 5-4 6Z"/></g>`;

function draw(p) {
  const label=`
<path d="M53 104H147V215Q100 224 53 215Z" fill="${ref('silver')}"/>
<path d="M85 105h53l-21 41 16-9-60 79H58l49-78-25 8Z" fill="${p.zero?'#d5ded7':ref('liquid')}" opacity="${p.zero?'.35':'.95'}"/>
${p.old?'':`<path d="M54 101H146V109H54Z" fill="#f4f5eb"/>${text(100,106.7,'HYDRATES BETTER THAN WATER',3.4,'#1e2926','font-weight="bold" textLength="76" lengthAdjust="spacingAndGlyphs"')}`}
${text(100,153,'G',55,'#fffef5','font-weight="bold" stroke="#17211f" stroke-width="1.1" paint-order="stroke" textLength="43" lengthAdjust="spacingAndGlyphs"')}
<path d="m100 126 16-5-9 9 10-2-28 26 9-19-9 2Z" fill="#f56417" stroke="#14201b" stroke-width="1"/>
${p.zero?text(100,173,'ZERO',21,'#f6f8ee','font-style="italic" font-weight="bold" stroke="#212b27" stroke-width="1.4" paint-order="stroke" textLength="61" lengthAdjust="spacingAndGlyphs"'):''}
${p.old?`${text(111,170,'GATORADE',4.1,'#3e4640','font-weight="bold"')}${text(111,177,'THIRST',6,'#3e4640','font-weight="bold"')}${text(111,183,'QUENCHER',6,'#3e4640','font-weight="bold"')}`:`<path d="M100 185h33v15h-43Z" fill="${p.labelColor}"/>${text(114,191,p.zero?'ZERO SUGAR':'ADVANCED',5.2,'#fffdf1','font-weight="bold" textLength="29" lengthAdjust="spacingAndGlyphs"')}${text(114,197,'REHYDRATION',3.7,'#fffdf1','font-weight="bold" textLength="29" lengthAdjust="spacingAndGlyphs"')}${person}`}
${p.old?'<path d="M91 191h39v8H91Z" fill="#bd2f28"/>':''}
${text(p.old?110:108,p.old?197:207,p.flavor.toUpperCase(),p.flavor.length>12?4.6:5.5,p.old?'#fff3e5':p.labelColor,'font-weight="bold" textLength="49" lengthAdjust="spacingAndGlyphs"')}
${text(103,216,p.zero?'GATORADE ZERO SUGAR':'GATORADE THIRST QUENCHER',3.3,'#24312b','font-weight="bold" textLength="62" lengthAdjust="spacingAndGlyphs"')}`;
  return wrap(p.slug,p.title,`${shadow(53)}
<path d="${shape}" fill="${ref('liquid')}" stroke="${p.dark}" stroke-opacity=".6" stroke-width=".7"/>
<g clip-path="${ref('bodyclip')}">
<path d="M61 99Q93 73 137 66M60 87Q89 63 121 60" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="2"/>
<path d="M64 82 74 70M129 70l9 15" fill="none" stroke="#fff" stroke-opacity=".62" stroke-width="3" stroke-linecap="round"/>
${label}
${[111,129,151,177,198,218,228].map((y,i)=>`<path d="M57 ${y}q43 ${i%2?5:3} 86 0" fill="none" stroke="${i===6?p.dark:'#4b6858'}" stroke-opacity="${i===6?'.3':'.16'}" stroke-width="${i===6?2:1.4}"/><path d="M59 ${y-1.4}q41 3 82 0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>`).join('')}
<path d="${shape}" fill="${ref('glass')}" opacity=".32"/>
<path d="M63 92V101M65 114l4 25M68 154l2 14-2 13M65 203v8M64 225v6" fill="none" stroke="#fff" stroke-opacity=".57" stroke-width="2.2"/>
<path d="M138 89v11M138 116l-4 23M133 155l-1 15 2 12M138 204v7" fill="none" stroke="#fff" stroke-opacity=".27" stroke-width="1.3"/>
</g>
<path d="M82 47q18 3 36 0M81 42q19 3 38 0" stroke="#e2e6ba" stroke-opacity=".6" stroke-width="1.2" fill="none"/>
<path d="M79 25q21-4 42 0v16q-21 5-42 0Z" fill="${ref('cap')}"/>
<ellipse cx="100" cy="25" rx="21" ry="3.5" fill="#f49a50"/>
<path d="M78 39q22 4 44 0v5q-22 5-44 0Z" fill="#dd6225"/>
${Array.from({length:23},(_,i)=>`<path d="M${80+i*1.8} 27v11" stroke="${i%2?'#f5af71':'#b84e19'}" stroke-width=".55" opacity=".65"/>`).join('')}
<path d="M80 44q20 3 40 0" fill="none" stroke="#ffc99a" stroke-width="1"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath>
${liquid('liquid',p.color,p.light,p.dark)}
<linearGradient id="__ID__silver"><stop stop-color="#818c87"/><stop offset=".21" stop-color="#d9dfd5"/><stop offset=".48" stop-color="#afb7ab"/><stop offset=".8" stop-color="#777f76"/><stop offset="1" stop-color="#c2cabe"/></linearGradient>
<linearGradient id="__ID__cap"><stop stop-color="#c85b1e"/><stop offset=".22" stop-color="#f8953c"/><stop offset=".6" stop-color="#f07a27"/><stop offset="1" stop-color="#bd5019"/></linearGradient>`);
}

const products=[
  {slug:'gatorade-lemon-lime',title:'Gatorade Lemon Lime',flavor:'Lemon Lime',upc:'0005200013515',color:'#badb24',light:'#d6e969',dark:'#85a723',labelColor:'#c0d92b',observations:'Individually inspected retailer bottle and manufacturer Lemon Lime image: yellow-green liquid, orange ribbed cap, contoured/ribbed 28oz PET bottle, silver wrap with yellow-green diagonal bolt field, white G/black outline and orange lightning; white hydration header, ADVANCED REHYDRATION lower label and LEMON LIME in yellow-green.'},
  {slug:'gatorade-fruit-punch',title:'Gatorade Fruit Punch',flavor:'Fruit Punch',upc:'0005200013513',color:'#de2d28',light:'#ef5a47',dark:'#b51e25',labelColor:'#de342e',old:true,observations:'Individually inspected Fruit Punch bottle: vivid red liquid and orange ribbed cap; contoured 28oz PET, silver wrap with red diagonal lightning field, white G with black outline/orange bolt. This selected retailer photo has the older lower GATORADE THIRST QUENCHER text plus red FRUIT PUNCH plaque, without the newer hydration header and athlete panel. Preserved rather than assuming sibling layout.'},
  {slug:'gatorade-orange',title:'Gatorade Orange',flavor:'Orange',upc:'0005200013514',color:'#f18b17',light:'#ffb945',dark:'#cf5a0d',labelColor:'#ee9837',observations:'Individually inspected Orange bottle: bright orange liquid, orange cap, contoured ribbed PET; silver wrap with orange diagonal field, large white G/orange lightning, white hydration header and orange ADVANCED REHYDRATION/ORANGE lower label.'},
  {slug:'gatorade-cool-blue',title:'Gatorade Cool Blue',flavor:'Cool Blue',upc:'0005200013517',color:'#008fc6',light:'#45c4e6',dark:'#00658e',labelColor:'#1ca2d2',observations:'Individually inspected Cool Blue bottle: saturated medium blue liquid and orange cap, ribbed 28oz bottle; silver wrap and blue diagonal field, white G/orange lightning, white hydration header and blue ADVANCED REHYDRATION / COOL BLUE lower treatment. Distinct deeper blue from Glacier Freeze.'},
  {slug:'gatorade-glacier-freeze',title:'Gatorade Glacier Freeze',flavor:'Glacier Freeze',upc:'0005200013519',color:'#28b7cf',light:'#78dce4',dark:'#13869d',labelColor:'#29bad3',observations:'Individually inspected Glacier Freeze bottle: lighter cyan/turquoise liquid, orange cap, contoured ribbed bottle; silver wrap and cyan diagonal field with white G/orange lightning; hydration header and cyan ADVANCED REHYDRATION / GLACIER FREEZE treatment. Distinct from Cool Blue.'},
  {slug:'gatorade-grape',title:'Gatorade Fierce Grape',flavor:'Fierce Grape',upc:'0005200013516',color:'#6d6da9',light:'#a1a1d0',dark:'#424977',labelColor:'#6a4a95',observations:'Individually inspected Fierce Grape bottle: blue-purple liquid, orange cap, contoured ribbed PET; silver wrap with purple lightning field, white G/orange bolt, hydration header and purple ADVANCED REHYDRATION / FIERCE GRAPE lower treatment. Selected Fierce Grape US retail version for the catalog Grape row.'},
  {slug:'gatorade-zero-lemon-lime',title:'Gatorade Zero Lemon Lime',flavor:'Lemon Lime',upc:'0005200004231',zero:true,color:'#bfd942',light:'#dce98b',dark:'#87a42c',labelColor:'#b3c832',observations:'Individually inspected Zero Lemon Lime bottle: pale yellow-green liquid, orange cap and same contoured PET; predominantly silver/white diagonal wrap rather than saturated regular-flavor bolt field; large white G/orange bolt, outlined italic ZERO, white hydration header, lime ZERO SUGAR REHYDRATION and LEMON LIME lower panel.'},
  {slug:'gatorade-zero-grape',title:'Gatorade Zero Grape',flavor:'Grape',upc:'0005200004327',zero:true,color:'#69568e',light:'#9a85b5',dark:'#443364',labelColor:'#70548c',observations:'Individually inspected Zero Grape bottle: deep translucent purple liquid, orange cap, contoured 28oz PET; silver/white diagonal wrap, large white G/orange bolt, outlined italic ZERO and purple ZERO SUGAR REHYDRATION / GRAPE lower label. Distinct silver Zero label and warmer purple from the blue-purple regular Fierce Grape.'},
];
export const records=products.map(p=>({
  slug:p.slug,family:'gatorade-contoured-bottle',
  packageChoice:`US 28 fl oz / 828mL ${p.title} orange-capped contoured PET bottle; representative retail size for size-unspecified catalog row.`,
  references:[{pageUrl:`https://www.kroger.com/p/${p.slug}-sports-drink-bottle/${p.upc}`,imageUrl:`https://www.kroger.com/product/images/large/front/${p.upc}`,inspectedAt:'2026-11-02',visuallyInspected:true,observations:p.observations},...(p.slug==='gatorade-lemon-lime'?[{pageUrl:'https://www.gatorade.com/sports-drinks/gatorade-thirst-quencher/lemon-lime-00052000135152',imageUrl:'https://www.datocms-assets.com/101859/1785939839-gatorade_28oz_gtq_rtd_lemon_lime_pdp_product-tile_2680x3344.png?auto=format&fit=max&w=1200',inspectedAt:'2026-11-02',visuallyInspected:true,observations:'Manufacturer Lemon Lime bottle independently inspected: orange cap, shoulder spiral recesses, waist/ribs and silver/yellow-green ADVANCED REHYDRATION wrap. Establishes shared current bottle material/perspective; each sibling separately checked.'}]:[])],
  uncertainty:`${p.old?'The selected Fruit Punch retailer image shows an older lower-label layout; revision date unverified.':'Selected documented retailer packaging; artwork revision date unverified.'} Catalog has no package size. Simplified original vector lettering, athlete silhouette and molded bottle details; tiny nutrition/certification and side-panel print omitted. Final aesthetic approval and native-device review pending.`,
  status:'needs-review',svg:draw(p),
}));
