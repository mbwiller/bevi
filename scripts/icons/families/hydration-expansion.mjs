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

const record=(d,family,packageChoice,pageUrl,imageUrl,svg,uncertainty='')=>({slug:d.slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations:d.observations}],uncertainty:`${uncertainty} Exact flavor references separately inspected. Representative US package selected where catalog has no size. Typography, fine package copy and material/fruit details are simplified original vectors; final aesthetic approval and native-device review pending.`,status:'needs-review',svg});
export const records=[
 ...bodyData.map(d=>record(d,'bodyarmor-sports-bottle',`US 16 fl oz BODYARMOR ${d.name.join(' ')} original Sports Drink bottle.`,`https://www.kroger.com/p/${d.page}/${d.upc}`,`https://www.kroger.com/product/images/large/front/${d.upc}`,bodyarmor(d),'Manufacturer exact product pages were checked first but returned JS-only shell without image links; inspected retailer front images used.')),
];
