import {wrap,shadow,ref,text} from '../style.mjs';

// Current exact flavor packages independently inspected on 2026-11-04.
const date='2026-11-04';
const cap=(color,light,w=38)=>`<path d="M${100-w/2} 24q ${w/2} -3.5 ${w} 0v15q ${-w/2} 4 ${-w} 0Z" fill="${color}"/><ellipse cx="100" cy="24" rx="${w/2}" ry="3.5" fill="${light}"/>${Array.from({length:17},(_,i)=>`<path d="M${102-w/2+i*(w-4)/16} 26v10" stroke="${light}" stroke-opacity=".55" stroke-width=".65"/>`).join('')}<path d="M${98-w/2} 40q ${w/2+2} 4 ${w+4} 0" fill="none" stroke="${light}" stroke-width="1.2"/>`;
const shade=(shape)=>`<path d="${shape}" fill="${ref('shade')}" opacity=".65"/>`;
const leaf=(x,y,s=1,r=0)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C-15-2-18-14-21-20-6-20 5-11 0 0Z" fill="#347d36"/><path d="M0 0-19-18" stroke="#a4bd6b" stroke-width=".8"/></g>`;
function orange(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><circle r="13" fill="#e6921c"/><path d="M-10-2A11 11 0 0 0 10-2Z" fill="#ffe6a4"/><path d="M-8-1A9 9 0 0 0 8-1Z" fill="#ffc54d"/><path d="m0-1-6 5m6-5 0 8m0-8 6 5" stroke="#fff2ca" stroke-width=".8"/></g>`;}
const strawberry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-9-3Q-11-14 0-12 12-14 10-1L0 13Z" fill="#d93239"/><path d="m-3-11-3-5 6 3 5-4-1 6 5-1-5 5Z" fill="#4d8c36"/>${[[-4,-6],[3,-5],[-1,0],[3,3],[0,7]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx=".55" ry="1.1" fill="#f5ce87"/>`).join('')}</g>`;
const gradients=(d)=>`<linearGradient id="__ID__drink"><stop stop-color="${d.dark}"/><stop offset=".24" stop-color="${d.light}"/><stop offset=".55" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></linearGradient>`;

const powerShape='M82 40h36v14q0 7 10 14l16 17q3 4 3 12v43q0 8-7 11l4 12-4 14 3 17-2 15 5 12q0 15-12 16H66q-12-1-12-16l5-12-2-15 3-17-4-14 4-12q-7-3-7-11V97q0-8 3-12l16-17q10-7 10-14Z';
function power(d){
 const zero=!!d.zero;
 const hex=Array.from({length:3},(_,row)=>[0,1,2].map(col=>{const x=67+col*32-(row%2?13:0),y=165+row*23;return `<path d="M${x-13} ${y-7}l13-7 13 7v12l-13 7-13-7Z" fill="${d.dark}" fill-opacity=".1" stroke="#e3f7ff" stroke-opacity=".28" stroke-width="1.2"/>`;}).join('')).join('');
 const label=`<path d="M53 88h94v59H53Z" fill="${zero?'#fcfcf0':d.label}"/>
<path d="M147 99v48H96Z" fill="${zero?'#278cc1':'#131918'}"/>
${zero?`${text(94,101,'POWERADE',10.5,'#2387b9','font-weight="bold" textLength="73" lengthAdjust="spacingAndGlyphs"')}${text(97,126,'ZERO',28,'#101616','font-weight="bold" textLength="81" lengthAdjust="spacingAndGlyphs"')}${text(79,137,'MIXED BERRY',5.7,'#167cac','font-weight="bold"')}`:`${text(98,108,'POWER',23.4,'#fffdf2','font-weight="bold" textLength="83" lengthAdjust="spacingAndGlyphs"')}${text(81,130,'ADE',23.4,'#fffdf2','font-weight="bold" textLength="48" lengthAdjust="spacingAndGlyphs"')}${text(58+Math.min(51,d.short.length*3.1)/2,140,d.short,5.6,'#fffdf2',`font-weight="bold" textLength="${Math.min(51,d.short.length*3.1)}" lengthAdjust="spacingAndGlyphs"`)}${d.tail?text(68,146,d.tail,4.3,'#fffdf2','font-weight="bold"'):''}`}
${text(131,133,'50%',8,'#d9e4e6','font-weight="bold"')}${text(131,139,'MORE',3.5,'#d9e4e6')}${text(131,144,'ELECTROLYTES',2.8,'#d9e4e6','textLength="27" lengthAdjust="spacingAndGlyphs"')}`;
 return wrap(d.slug,d.title,`${shadow(59)}<path d="${powerShape}" fill="${ref('drink')}" stroke="${d.dark}" stroke-width=".7"/>
<g clip-path="${ref('bottle')}"><path d="M84 43h32v10H84Z" fill="#d4eff3" opacity=".65"/>
<path d="M86 54q-5 10-20 27" fill="none" stroke="#edfaff" stroke-opacity=".4" stroke-width="2.5"/>
${label}${hex}
<path d="M60 153q40 8 80 0M60 211q40 8 80 0M59 219q41 8 82 0M65 230q35 5 70 0" fill="none" stroke="#daf1f5" stroke-opacity=".3" stroke-width="1.6"/>
${Array.from({length:22},(_,i)=>`<ellipse cx="${63+i*17%73}" cy="${68+i*31%151}" rx="${i%4?.55:.9}" ry="${i%4?.8:1.35}" fill="#fff" opacity=".22"/>`).join('')}
${shade(powerShape)}<path d="M63 94V214" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>
</g>${cap(zero?'#d5d8d5':'#202724',zero?'#edf0ea':'#3f4842',41)}`,
`<clipPath id="__ID__bottle"><path d="${powerShape}"/></clipPath>${gradients(d)}`);
}
const powerData=[
 {slug:'powerade-mountain-berry-blast',title:'Powerade Mountain Berry Blast',short:'MOUNTAIN BERRY',tail:'BLAST',file:'powerade/Powerade-Desktop-MountainBerryBlast-750x750.jpg',color:'#218ec8',light:'#64b7df',dark:'#176caa',label:'#258cbe',observations:'Manufacturer Mountain Berry Blast exact photo inspected: black screw cap, clear neck and bright blue drink in broad molded bottle with hexagonal grip cells and lobed base. Blue upper label, large white POWER / ADE split lettering, MOUNTAIN BERRY BLAST, black lower-right diagonal50% more electrolytes panel. Representative28oz format chosen from manufacturer sizes; photo backdrops excluded.'},
 {slug:'powerade-fruit-punch',title:'Powerade Fruit Punch',short:'FRUIT PUNCH',file:'powerade/Powerade-Desktop-FruitPunch-750x750.jpg',color:'#bf244b',light:'#e25f7b',dark:'#921b3c',label:'#ca1733',observations:'Separate manufacturer Fruit Punch image inspected: black cap, translucent red/pink drink, hexagonal molded grip and lobed base, red upper label with white POWER / ADE, small FRUIT PUNCH and black diagonal electrolyte panel. Color/label individually checked; not Zero Fruit Punch.'},
 {slug:'powerade-grape',title:'Powerade Grape',short:'GRAPE',file:'powerade/Powerade-Desktop-Grape-750x750.jpg',color:'#8050a3',light:'#b592c8',dark:'#543374',label:'#6f358b',observations:'Separate manufacturer Grape image inspected: black cap, transparent purple drink in broad hex-grip PET, purple upper label with large white two-line POWER / ADE and GRAPE, black lower-right electrolyte panel. Original Grape independently checked; not Zero Grape.'},
 {slug:'powerade-zero-mixed-berry',title:'Powerade Zero Mixed Berry',short:'MIXED BERRY',zero:true,file:'powerade-zero/PoweradeZero-Desktop-MixedBerry-750x750.jpg',color:'#2698cd',light:'#72c4e4',dark:'#1472ad',label:'#fffef2',observations:'Separate manufacturer Zero Mixed Berry image inspected: pale gray/white cap, blue drink, same broad hex-grip bottle, white upper label with small blue POWERADE, oversized black ZERO, blue MIXED BERRY and blue diagonal50% electrolyte panel. White cap/label are variant defining; not the Original Mountain Berry label.'},
];

const bodyShape='M83 40h34v10q0 8 12 21l12 20-3 12 2 25-3 9 3 26-3 9 3 27-3 9 3 15q0 9-12 10H72q-12-1-12-10l3-15-3-9 3-27-3-9 3-26-3-9 2-25-3-12 12-20q12-13 12-21Z';
function bodyarmor(d){
 const fruits=d.key==='pink'?`${strawberry(74,165,.65)}<ellipse cx="77" cy="199" rx="6.5" ry="9" fill="#f3d892"/>`:d.key==='orange'?`${orange(75,171,.71)}<path d="M68 194q14-8 18 4l-2 11-17-4Z" fill="#f2bc3f"/>`:`<circle cx="75" cy="157" r="5.5" fill="#aa202c"/><path d="M74 152q-3-9 4-11" stroke="#527c32" stroke-width=".8" fill="none"/>${orange(75,177,.7)}<path d="m66 204 14-13 6 13Z" fill="#ecc63e"/>`;
 const body=`<path d="M61 88h78v147H61Z" fill="${d.label}"/>
<path d="M65 52q35 7 70 0l8 37q-43 14-86 0Z" fill="#222927"/>
${text(100,73,d.name[0],6,'#f8f8ed','font-weight="bold"')}${text(100,81,d.name[1]||'',6,'#f8f8ed','font-weight="bold"')}
${fruits}<path d="M88 91h26v144H88Z" fill="#171e1c"/>
<g transform="translate(106 163) rotate(-90)">${text(0,0,'BODYARMOR',18,'#c5c9c6','font-weight="900" textLength="131" lengthAdjust="spacingAndGlyphs" letter-spacing="-.7"')}</g>
${text(126,101,'SPORTS',3.6,'#292f2b','font-weight="bold"')}${text(126,107,'DRINK',3.6,'#292f2b','font-weight="bold"')}
${[117,145,174,205].map(y=>`<path d="M61 ${y}q11 3 26 0M115 ${y}q11 3 24 0" fill="none" stroke="${d.dark}" stroke-opacity=".55" stroke-width="1.5"/><path d="M62 ${y+2}q10 3 25 0M115 ${y+2}q11 3 24 0" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="1"/>`).join('')}
${shade(bodyShape)}<path d="M66 96V216" stroke="#fff" stroke-opacity=".18" stroke-width="2.3" fill="none"/>`;
 return wrap(d.slug,d.title,`${shadow(51)}<path d="${bodyShape}" fill="${ref('drink')}" stroke="${d.dark}" stroke-width=".7"/><g clip-path="${ref('bottle')}">${body}</g>${cap('#171e1b','#3e4741',36)}`,
 `<clipPath id="__ID__bottle"><path d="${bodyShape}"/></clipPath>${gradients(d)}`);
}
const bodyData=[
 {slug:'bodyarmor-fruit-punch',title:'BODYARMOR Fruit Punch',key:'red',name:['FRUIT','PUNCH'],upc:'0085817600213',page:'bodyarmor-sports-drink-fruit-punch-bottle',color:'#ec2f4c',light:'#ff6573',dark:'#bb1234',label:'#ed2949',observations:'Exact retailer16oz Fruit Punch photo inspected after manufacturer product page exposed only JS shell: black cap/black sloping shoulder with white FRUIT PUNCH, red full-body wrap with horizontal molded grip ribs, central black vertical stripe and silver-gray vertical BODYARMOR, small SPORTS DRINK at right; fruit pictures left. Distinct from Zero Sugar and LYTE.'},
 {slug:'bodyarmor-strawberry-banana',title:'BODYARMOR Strawberry Banana',key:'pink',name:['STRAWBERRY','BANANA'],upc:'0085817600206',page:'bodyarmor-superdrink-strawberry-banana-sports-drink-bottle',color:'#f15b83',light:'#ff91a5',dark:'#cf3765',label:'#ef5c84',observations:'Separate retailer16oz Strawberry Banana photo inspected: black cap/shoulders, white STRAWBERRY BANANA shoulder text, pink wrap, black central vertical BODYARMOR stripe and silver-gray letters, strawberry and banana pictures left, molded horizontal grip ribs. Original Sports Drink checked independently; not LYTE Strawberry Banana.'},
 {slug:'bodyarmor-orange-mango',title:'BODYARMOR Orange Mango',key:'orange',name:['ORANGE','MANGO'],upc:'0085817600205',page:'bodyarmor-orange-mango-sports-drink-bottle',color:'#f4a12d',light:'#ffc359',dark:'#d17d17',label:'#f8a327',observations:'Separate retailer16oz Orange Mango photo inspected: black cap/shoulder with white ORANGE MANGO, orange/yellow wrap, black vertical central stripe and silver-gray BODYARMOR, orange wedge and mango pictures at left, small Sports Drink copy right and horizontal molded ribs. Exact flavor rather than inferred from Fruit Punch.'},
];

const primeShape='M79 40h42v12q0 9 11 23 13 17 13 36l-2 9 2 27-2 9 2 27-2 9 2 28q0 13-13 14H68q-13-1-13-14l2-28-2-9 2-27-2-9 2-27-2-9q0-19 13-36 11-14 11-23Z';
function star(x,y,r=3,color='#fff'){return `<path d="M${x} ${y-r}l${r*.25} ${r*.7} ${r*.75} 0-${r*.57} ${r*.45} ${r*.22} ${r*.75}-${r*.65}-${r*.45}-${r*.65} ${r*.45} ${r*.22}-${r*.75}-${r*.57}-${r*.45} ${r*.75} 0Z" fill="${color}"/>`;}
function prime(d){
 const ice=d.key==='ice';
 const pattern=ice?`<path d="M54 44h92v83q-45 7-92 0Z" fill="#ed2735"/><path d="M54 127q46 7 92 0v50q-46-8-92 0Z" fill="#f6f4ed"/><path d="M54 177q46-8 92 0v58H54Z" fill="#36b8de"/>${Array.from({length:32},(_,i)=>star(60+i*19%80,60+i*31%163,2+(i%3),i%3?'#fff6ef':'#cf1529')).join('')}`:'';
 const label=`${pattern}<path d="M79 41h42v12H79Z" fill="#f1f3e8" opacity=".87"/>
${text(100,76,d.name[0],6.5,ice?'#fffdf4':'#14292c','font-weight="bold" letter-spacing="1"')}
${text(100,85,d.name[1]||'',6.5,ice?'#fffdf4':'#14292c','font-weight="bold" letter-spacing=".7"')}
<g transform="translate(75 150) rotate(90)">${text(0,0,'PRIME',70,ice?'#f5f4ed':'#171d1d',`font-weight="900" textLength="119" lengthAdjust="spacingAndGlyphs" stroke="${ice?'#111a1b':'#fffdf1'}" stroke-width="${ice?'2.1':'1'}" paint-order="stroke" letter-spacing="-1.8"`)}</g>
${text(100,220,'HYDRATION DRINK',4.9,'#172d33','font-weight="bold" letter-spacing=".2"')}
${text(100,229,'16.9 FL OZ (500mL)',3.9,'#172d33','letter-spacing=".3"')}
${[120,154,188,215].map(y=>`<path d="M58 ${y}q42 6 84 0" stroke="#fff" stroke-opacity=".18" stroke-width="1.3" fill="none"/>`).join('')}`;
 return wrap(d.slug,d.title,`${shadow(56)}<path d="${primeShape}" fill="${ref('drink')}" stroke="${d.dark}" stroke-width=".6"/><g clip-path="${ref('bottle')}">${label}${shade(primeShape)}<path d="M64 87v131" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.4"/></g>${cap(d.cap,d.capLight,48)}`,
`<clipPath id="__ID__bottle"><path d="${primeShape}"/></clipPath>${gradients(d)}`);
}
const primeData=[
 {slug:'prime-hydration-lemon-lime',title:'PRIME Hydration Lemon Lime',key:'lime',name:['LEMON','LIME'],page:'hydration-lemon-lime',image:'https://drinkprime.com/cdn/shop/products/PrimeHydration_1serve_lemonlime_0000_1200x.png?v=1656076731',color:'#9dca48',light:'#bddf68',dark:'#77a631',cap:'#93bf39',capLight:'#c1e770',observations:'Manufacturer Lemon Lime Hydration bottle photo separately inspected:16.9floz/500mL contoured bottle, lime-green ribbed cap and opaque lime-green wrap, clear/white neck ring, black shoulder LEMON LIME, huge black sideways vertical PRIME with white perimeter, black HYDRATION DRINK and volume at foot. Hydration product, not Energy can or Zero Hydration.'},
 {slug:'prime-hydration-blue-raspberry',title:'PRIME Hydration Blue Raspberry',key:'blue',name:['BLUE','RASPBERRY'],page:'hydration-blue-raspberry',image:'https://drinkprime.com/cdn/shop/products/PrimeHydration_1serve_bluerasberry_0000_1200x.png?v=1656076581',color:'#38b9e0',light:'#6ed3ec',dark:'#168fb7',cap:'#21afd6',capLight:'#74d4ed',observations:'Manufacturer Blue Raspberry Hydration bottle individually inspected:16.9floz/500mL, cyan cap/opaque cyan wrap, white neck ring, black BLUE RASPBERRY shoulder text, oversized black vertical PRIME white outlined, black HYDRATION DRINK and volume, molded wrap-following ribs. Caffeine-free Hydration, not similarly named Energy.'},
 {slug:'prime-hydration-ice-pop',title:'PRIME Hydration Ice Pop',key:'ice',name:['ICE POP'],page:'hydration-ice-pop',image:'https://drinkprime.com/cdn/shop/files/PH_US_1serve_16.9oz_IcePopDaysofSummer_00000_1200x.png?v=1779213255',color:'#42bfdc',light:'#84d5e9',dark:'#238fae',cap:'#ed2939',capLight:'#ff6971',observations:'Manufacturer current Ice Pop Hydration16.9floz/500mL front image separately inspected: red cap and shoulder, white central field, cyan lower field with stars throughout; white vertical PRIME with heavy black surround and fine red/blue edge accents, white ICE POP at shoulder, black HYDRATION DRINK/volume below. Current summer star-art package deliberately selected; small anniversary emblem simplified/omitted, not replaced with another flavor.'},
];
const record=(d,family,packageChoice,pageUrl,imageUrl,svg,uncertainty='')=>({slug:d.slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations:d.observations}],uncertainty:`${uncertainty} Exact flavor references separately inspected. Representative US package selected where catalog has no size. Typography, fine package copy and material/fruit details are simplified original vectors; final aesthetic approval and native-device review pending.`,status:'needs-review',svg});
export const records=[
 ...powerData.map(d=>record(d,'powerade-sports-bottle',`US 28 fl oz POWERADE ${d.title.replace('Powerade ','')} hex-grip PET bottle.`,`https://www.powerade.com/products/${d.zero?'powerade-zero':'powerade'}`,`https://www.powerade.com/content/dam/powerade/us/en/products/${d.file}`,power(d),'Manufacturer current package chosen; advertising diagonal backdrop and condensation simplified.')),
 ...bodyData.map(d=>record(d,'bodyarmor-sports-bottle',`US 16 fl oz BODYARMOR ${d.name.join(' ')} original Sports Drink bottle.`,`https://www.kroger.com/p/${d.page}/${d.upc}`,`https://www.kroger.com/product/images/large/front/${d.upc}`,bodyarmor(d),'Manufacturer exact product pages were checked first but returned JS-only shell without image links; inspected retailer front images used.')),
 ...primeData.map(d=>record(d,'prime-hydration-bottle',`US 16.9 fl oz / 500mL PRIME ${d.name.join(' ')} Hydration bottle${d.key==='ice'?', documented current summer star-art edition':''}.`,`https://drinkprime.com/products/${d.page}`,d.image,prime(d),'Hydration bottle identity explicitly checked against Energy/Zero Hydration; current reference artwork recorded without claiming all packaging revisions are identical.')),
];
