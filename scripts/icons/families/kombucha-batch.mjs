import {wrap,shadow,ref,text} from '../style.mjs';

// Current manufacturer 16oz SYNERGY bottles, each inspected independently.
// Reference marketing halos are excluded; only the product is illustrated.
const shape='M84 35h32v15c0 7 13 11 18 25q5 10 5 23v121q0 15-39 15t-39-15V98q0-13 5-23c5-14 18-18 18-25Z';
const silver='<linearGradient id="__ID__silver"><stop stop-color="#c7ceca"/><stop offset=".24" stop-color="#fffef9"/><stop offset=".53" stop-color="#f5f5ed"/><stop offset=".85" stop-color="#c7ccca"/><stop offset="1" stop-color="#eef0e9"/></linearGradient>';
const shield='M61 112C75 108 92 98 100 85C108 98 125 108 139 112V160Q137 172 100 175T61 160Z';
function lotus(p) {
  return `<g transform="translate(100 177)">
${Array.from({length:8},(_,i)=>`<path d="M0-2C-10-10-7-20 0-25C7-20 10-10 0-2Z" fill="${ref('petal')}" stroke="#b4bcb7" stroke-width="1.6" transform="rotate(${i*45})"/><path d="M0-5C-5-11-4-17 0-21C4-17 5-11 0-5Z" fill="${p.rainbow?['#f18921','#c0d735','#27b2c3','#549f7e','#b7d829','#f2cd25','#f28928','#ed6b2b'][i]:ref('petalcolor')}" stroke="#fffdf3" stroke-width=".7" transform="rotate(${i*45})"/>`).join('')}
<circle r="4" fill="${p.accent}" stroke="#c1c8b7" stroke-width="1.4"/><circle r="1.7" fill="#f7e5aa"/>
</g>`;
}
function draw(p) {
  const rings=p.rings?Array.from({length:16},(_,i)=>`<ellipse cx="100" cy="177" rx="${14+i*3.5}" ry="${11+i*2.5}" fill="none" stroke="#fbd65e" stroke-opacity=".23" stroke-width=".85"/>`).join(''):'';
  return wrap(p.slug,p.title,`${shadow(51)}
<path d="${shape}" fill="${ref('liquid')}" stroke="${p.edge}" stroke-width=".7"/>
<g clip-path="${ref('bottleclip')}">
<path d="M64 112Q100 85 136 112V223Q100 240 64 223Z" fill="${ref('labelcolor')}"/>
${rings}
<path d="${shield}" fill="${ref('silver')}" stroke="#afb6b1" stroke-width="1.1"/>
<path d="M61 111Q88 103 100 87Q112 103 139 111" fill="none" stroke="${p.rainbow?ref('rainbow'):p.accent}" stroke-width="2.5"/>
${Array.from({length:17},(_,i)=>{const x=62+i*4.75,y=110-20*(1-Math.abs(x-100)/38)**1.5;return `<circle cx="${x}" cy="${y}" r=".5" fill="#f6f6de"/>`;}).join('')}
<path d="M100 103C99 108 92 111 92 116a8 8 0 0 0 16 0C108 111 101 108 100 103Z" fill="none" stroke="#918331" stroke-width=".9"/>
${text(100,118,"GT's",6.9,'#8d8031','style="font-family:Georgia,serif;font-weight:bold;font-style:italic"')}
${text(100,123,'EST 1995',2.5,'#918331','letter-spacing=".5"')}
${p.rainbow?[...'SYNERGY'].map((letter,i)=>text(69+i*10.4,143,letter,19.5,['#e98824','#e9c428','#c2cf48','#8ebd60','#55aa80','#2b9e9a','#168cad'][i],'style="font-family:Times New Roman,serif" textLength="10.4" lengthAdjust="spacingAndGlyphs"')).join(''):text(100,143,'SYNERGY',19.5,p.accent,'style="font-family:Times New Roman,serif" letter-spacing="-.9" textLength="72" lengthAdjust="spacingAndGlyphs"')}
${text(100,152,'THE REAL KOMBUCHA',5.3,'#252827','style="font-family:Times New Roman,serif" textLength="66" lengthAdjust="spacingAndGlyphs"')}
${lotus(p)}
${p.flavor==='Guava Goddess'?`${text(100,204,'GUAVA',7.5,'#fffaf2','style="font-family:Georgia,serif;font-weight:bold" letter-spacing="1.3"')}${text(100,213,'GODDESS',7.5,'#fffaf2','style="font-family:Georgia,serif;font-weight:bold" letter-spacing=".9"')}`:text(100,210,p.flavor.toUpperCase(),8,'#2a2a24','style="font-family:Georgia,serif;font-weight:bold" letter-spacing=".7"')}
<path d="M63 220Q85 226 100 221Q115 226 137 220V230Q114 230 100 235Q86 230 63 230Z" fill="${ref('silver')}" stroke="#afb6b1" stroke-width=".7"/>
${text(100,227,'9 BILLION',3.5,'#30332d','style="font-family:Georgia,serif;font-weight:bold" letter-spacing=".5"')}
${text(100,231,'LIVING PROBIOTICS',3.4,'#30332d','style="font-family:Georgia,serif;font-weight:bold"')}
<path d="M64 232q36 7 72 0" fill="none" stroke="${p.rainbow?ref('rainbow'):p.accent}" stroke-width="1.5"/>
<path d="${shape}" fill="${ref('shade')}" opacity=".55"/>
<path d="M71 90v119M86 43v10q-16 14-16 32" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2.4"/>
<path d="M131 89v117M114 45v9q14 12 16 30" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width="1.4"/>
</g>
<path d="M84 40q16 4 32 0M83 44q17 4 34 0" fill="none" stroke="#c3cfbd" stroke-width="1.3"/>
<path d="M79 23q21-5 42 0v14q-21 6-42 0Z" fill="${ref('silver')}" stroke="#a7b2ac" stroke-width=".6"/>
<ellipse cx="100" cy="23" rx="21" ry="4" fill="#f5f7ed"/>
${Array.from({length:23},(_,i)=>`<path d="M${80+i*1.8} 25v10" stroke="#aeb9b2" stroke-width=".45" opacity=".75"/>`).join('')}
<path d="M78 36q22 4 44 0v3q-22 4-44 0Z" fill="#e6ebe1"/>
`, `<clipPath id="__ID__bottleclip"><path d="${shape}"/></clipPath>${silver}
<linearGradient id="__ID__liquid"><stop stop-color="${p.dark}"/><stop offset=".22" stop-color="${p.light}"/><stop offset=".55" stop-color="${p.color}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient>
<linearGradient id="__ID__rainbow"><stop stop-color="#ef7c25"/><stop offset=".25" stop-color="#eacb21"/><stop offset=".5" stop-color="#a8cf68"/><stop offset=".75" stop-color="#44aa86"/><stop offset="1" stop-color="#199ab8"/></linearGradient>
${p.rainbow?'<linearGradient id="__ID__labelcolor"><stop stop-color="#d66d25"/><stop offset=".26" stop-color="#f2d13d"/><stop offset=".5" stop-color="#afca55"/><stop offset=".74" stop-color="#4eaf8b"/><stop offset="1" stop-color="#1da4bb"/></linearGradient>':`<radialGradient id="__ID__labelcolor" cx=".5" cy=".6" r=".7"><stop stop-color="${p.labelLight}"/><stop offset="1" stop-color="${p.accent}"/></radialGradient>`}
<linearGradient id="__ID__petal"><stop stop-color="#fffef4"/><stop offset="1" stop-color="#e0e5de"/></linearGradient>
<linearGradient id="__ID__petalcolor"><stop stop-color="${p.labelLight}"/><stop offset="1" stop-color="${p.accent}"/></linearGradient>`);
}
const products=[
 {slug:'gts-kombucha-gingerade',title:"GT's Synergy Gingerade",flavor:'Gingerade',image:'SYN_FLAVORS_6.png?v=1735704017',color:'#df9d13',light:'#efc34e',dark:'#b5710b',edge:'#a07121',accent:'#c42b30',labelLight:'#f2d54c',rings:true,observations:'Manufacturer Gingerade 16oz bottle individually inspected: rounded clear glass with short neck, white ribbed cap, golden/amber kombucha; ornate silver pointed shield and red beaded border, red SYNERGY over THE REAL KOMBUCHA, gold GT monogram, silver-edged eight-petal orange/yellow flower; orange topographic-ring lower field with black GINGERADE, silver probiotic footer. Marketing halo behind reference excluded.'},
 {slug:'gts-kombucha-trilogy',title:"GT's Synergy Trilogy",flavor:'Trilogy',image:'SYN_FLAVORS_5.png?v=1735703876',color:'#c23e29',light:'#e66c39',dark:'#963026',edge:'#7d3b29',accent:'#c9bf26',labelLight:'#d8d755',rainbow:true,observations:'Manufacturer Trilogy 16oz bottle independently inspected: same clear rounded bottle and white cap; red-orange liquid, silver pointed upper shield, rainbow SYNERGY wordmark and matching silver-edged multicolor flower, lower field transitions orange/yellow/green/teal; black TRILOGY above silver probiotic footer. Checked independently from Gingerade and Guava Goddess.'},
 {slug:'gts-kombucha-guava-goddess',title:"GT's Synergy Guava Goddess",flavor:'Guava Goddess',image:'SYN_FLAVORS_9.png?v=1735706670',color:'#dc6575',light:'#ef9b9b',dark:'#ba425e',edge:'#a94e5b',accent:'#d62c72',labelLight:'#f7a2c0',observations:'Manufacturer Guava Goddess 16oz bottle independently inspected: coral-pink liquid, white ribbed cap and short clear glass neck; ornate silver upper shield with pink beaded border and pink SYNERGY, silver-edged magenta flower, pink/magenta lower field with white two-line GUAVA GODDESS and silver probiotic footer. Separate from rainbow Trilogy and orange Gingerade.'},
];
export const records=products.map(p=>({slug:p.slug,family:'synergy-kombucha-glass-bottle',packageChoice:`US 16 fl oz / 473mL GT's SYNERGY ${p.flavor} clear glass bottle; current manufacturer package for size-unspecified catalog row.`,references:[{pageUrl:`https://gtslivingfoods.com/products/${p.slug}`,imageUrl:`https://gtslivingfoods.com/cdn/shop/files/${p.image}&width=1100`,inspectedAt:'2026-11-02',visuallyInspected:true,observations:p.observations}],uncertainty:'Representative US 16oz SYNERGY package selected; catalog does not specify package size or historical label. Original vectors simplify ornamental borders/monogram/flower and fine print; no reference photo or marketing backdrop is embedded. Final aesthetic approval and native-device review pending.',status:'needs-review',svg:draw(p)}));
