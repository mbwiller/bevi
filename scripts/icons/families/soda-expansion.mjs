import {wrap,shadow,ref,text} from '../style.mjs';
import {records as colas} from './colas.mjs';
const drops=(x,y,w,h,n=18)=>Array.from({length:n},(_,i)=>`<ellipse cx="${x+(i*19)%w}" cy="${y+(i*31)%h}" rx="${i%3===0?1.2:.7}" ry="${i%3===0?1.8:1}" fill="#fff" opacity=".28"/>`).join('');

function can(slug,title,label,{slim=false,color='#f6f5ee',defs=''}={}) {
 const l=slim?60:55,r=200-l,t=slim?24:41,b=229,rx=100-l-6;
 const shape=`M${l+6} ${t}Q100 ${t-9} ${r-6} ${t}L${r} ${t+17}V${b-9}Q${r} ${b+4} 100 ${b+4}T${l} ${b-9}V${t+17}Z`;
 return wrap(slug,title,`${shadow(slim?49:58)}<path d="${shape}" fill="${color}"/><g clip-path="${ref('bodyclip')}">${label}<path d="${shape}" fill="${ref('shade')}"/>${drops(l+10,t+24,r-l-20,b-t-40)}<path d="M${l+10} ${t+20}V${b-18}" fill="none" stroke="#fff" stroke-opacity=".21" stroke-width="3"/></g><ellipse cx="100" cy="${t}" rx="${rx}" ry="8" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.2"/><ellipse cx="100" cy="${t}" rx="${rx-5}" ry="5.5" fill="none" stroke="#8d9892" stroke-width=".8"/><ellipse cx="104" cy="${t+1}" rx="8" ry="3.5" fill="#657169"/><path d="M93 ${t-2}h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="#e6e8de" stroke-width="2.4"/><path d="M${l+3} ${b-3}q${r-l-6>>1} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/><path d="M${l+6} ${b+1}q${r-l-12>>1} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>`,`<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath>${defs}`);
}


const evidence=[
  {
    "slug": "poppi-cola",
    "pageUrl": "https://www.drinkpoppi.com/products/classic-cola",
    "imageUrl": "https://assets.decovostatic.com/static-images/poppi/poppi/pdp/live/classic-cola-01.webp"
  },
  {
    "slug": "poppi-doc-pop",
    "pageUrl": "https://www.drinkpoppi.com/products/doc-pop",
    "imageUrl": "https://assets.decovostatic.com/static-images/poppi/poppi/pdp/live/doc-pop-01.webp"
  },
  {
    "slug": "poppi-orange",
    "pageUrl": "https://www.drinkpoppi.com/products/orange",
    "imageUrl": "https://assets.decovostatic.com/static-images/poppi/poppi/pdp/live/orange-01.webp"
  },
  {
    "slug": "poppi-strawberry-lemon",
    "pageUrl": "https://www.drinkpoppi.com/products/strawberry-lemon",
    "imageUrl": "https://assets.decovostatic.com/static-images/poppi/poppi/pdp/live/strawberry-lemon-01.webp"
  },
  {
    "slug": "olipop-strawberry-vanilla",
    "pageUrl": "https://drinkolipop.com/products/strawberry-vanilla",
    "imageUrl": "https://cld.accentuate.io/30315220959302/1755694432300/strawberry-vanilla-9g-olipop_12pack-main-image_new_asset.webp?v=1779160900583w_360"
  },
  {
    "slug": "olipop-orange-squeeze",
    "pageUrl": "https://drinkolipop.com/products/orange-squeeze",
    "imageUrl": "https://cld.accentuate.io/35768781111455/1755695008206/orange-squeeze-9g-olipop_12pack-main-image_new_asset.webp?v=1779162334338w_360"
  },
  {
    "slug": "olipop-classic-root-beer",
    "pageUrl": "https://drinkolipop.com/products/classic-root-beer",
    "imageUrl": "https://cld.accentuate.io/31199447679040/1755695916798/classic-root-beer-9g-olipop_12pack-main-image_new_asset.webp?v=1779161791544w_360"
  },
  {
    "slug": "fanta-zero-orange",
    "pageUrl": "https://www.coca-cola.com/us/en/brands/fanta/products",
    "imageUrl": "https://www.coca-cola.com/content/dam/onexp/us/en/brands/fanta/fanta-zero-sugar-orange-packshot-us-en.png"
  },
  {
    "slug": "fanta-strawberry",
    "pageUrl": "https://www.coca-cola.com/us/en/brands/fanta/products",
    "imageUrl": "https://www.coca-cola.com/content/dam/onexp/us/en/brands/fanta/fanta-strawberry-packshot-us-en.png"
  },
  {
    "slug": "fanta-grape",
    "pageUrl": "https://www.coca-cola.com/us/en/brands/fanta/products",
    "imageUrl": "https://www.coca-cola.com/content/dam/onexp/us/en/brands/fanta/fanta-grape-packshot-us-en.png"
  },
  {
    "slug": "fanta-pineapple",
    "pageUrl": "https://www.coca-cola.com/us/en/brands/fanta/products",
    "imageUrl": "https://www.coca-cola.com/content/dam/onexp/us/en/brands/fanta/fanta-pineapple-packshot-us-en.png"
  },
  {
    "slug": "pepsi-wild-cherry",
    "pageUrl": "https://www.fredmeyer.com/p/pepsi-cola-wild-cherry-soda-cans/0001200080999",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0001200080999"
  },
  {
    "slug": "cherry-coke",
    "pageUrl": "https://www.kroger.com/p/coca-cola-cherry-soda-can/0004900000050",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0004900000050"
  }
];
// Individually inspected exact flavor packshots, 2026-11-10. Shared primitives
// preserve the frozen can geometry; brand/flavor layouts follow those photos.
const leaf=(x,y,s=1,c='#21823b')=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0Q-26 4-24-18Q-4-23 0 0" fill="${c}"/><path d="M-21-16-1-1" stroke="#94bf52" stroke-width=".9"/></g>`;
const wheel=(x,y,r,c='#f1a52c',skin='#e77e21')=>`<g transform="translate(${x} ${y})"><circle r="${r}" fill="${skin}"/><circle r="${r-2}" fill="#fff0ad"/><circle r="${r-4}" fill="${c}"/>${Array.from({length:8},(_,i)=>`<path d="M0 0 ${Math.cos(i*Math.PI/4)*(r-4)} ${Math.sin(i*Math.PI/4)*(r-4)}" stroke="#fff0ad" stroke-width="1"/>`).join('')}<circle r="2" fill="#fff0ad"/></g>`;
const berry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-13-8Q-14-20 0-16Q15-20 14-7L1 17Z" fill="#e83b45"/><path d="m0-15-10-9 4 10-10-1 12 7 3-6 8 3-2-7 8-2Z" fill="#187248"/>${[[-7,-8],[3,-7],[-3,0],[5,2],[0,9]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx="1" ry="1.5" fill="#ffd6a1"/>`).join('')}</g>`;
const cherry=(x,y,s=1,c='#bf163b')=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-10Q-14-22-18-6Q-22 12-6 17Q8 22 16 7Q23-12 8-13Z" fill="${c}"/><path d="M-10-7q-6 1-5 9" stroke="#ffb1ac" stroke-width="2.7" stroke-linecap="round" fill="none"/><path d="M3-11Q7-29 18-35" stroke="#253d62" stroke-width="2.1" fill="none"/></g>`;
const grape=(x,y,s=1,c='#8138a1')=>`<g transform="translate(${x} ${y}) scale(${s})">${leaf(6,-18,.7)}${[[-12,-8],[3,-12],[14,-4],[-17,5],[-2,4],[11,11],[-8,18],[3,25]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="9" fill="${c}" stroke="#bc78c6" stroke-width=".8"/><path d="M${x-4} ${y-4}q3-3 6 0" stroke="#e2b1e4" stroke-width="1.5" fill="none" opacity=".7"/>`).join('')}</g>`;
const flower=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})">${Array.from({length:5},(_,i)=>`<ellipse cy="-7" rx="4" ry="8" transform="rotate(${i*72})" fill="#fff5d3"/>`).join('')}<circle r="3" fill="#e8c348"/></g>`;
const stars=(c)=>Array.from({length:10},(_,i)=>{const x=60+i*23%82,y=140+i*31%77;return `<path d="M${x-3} ${y}h6m-3-3v6" stroke="${c}" stroke-width=".7" opacity=".65"/>`}).join('');
function capArt(x,y,s,c,angle=0){return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${s})"><path d="${Array.from({length:40},(_,i)=>{const a=i*Math.PI/20,r=i%2?21:24;return `${i?'L':'M'}${Math.cos(a)*r} ${Math.sin(a)*r*.48}`}).join('')}Z" fill="${c}" stroke="#f3c9d7" stroke-width="1"/><ellipse rx="19" ry="8.2" cy="-2" fill="${c}" stroke="#fff" stroke-opacity=".65" stroke-width="1"/><path d="M-12-4q9-5 19-1" fill="none" stroke="#fff" stroke-width="1.4" opacity=".65"/></g>`;}
const poppiSpecs=[['cola','Classic Cola','#fa192a','#ffafb3','seal'],['doc-pop','Doc Pop','#ce54ca','#8f1649','cherry'],['orange','Orange','#ff8a09','#ffdf38','orange'],['strawberry-lemon','Strawberry Lemon','#f332a2','#f4ec19','strawberry']];
function poppi(d){const[f,name,c,accent,kind]=d,slug='poppi-'+f;
 let art=kind==='seal'?`<circle cx="117" cy="140" r="26" fill="${accent}"/><circle cx="111" cy="199" r="18" fill="${accent}"/>${[[-1,0],[29,3],[13,24]].map(([x,y])=>`<path d="m${100+x} ${125+y} 3 3-3 3" stroke="${c}" stroke-width="1.2" fill="none"/>`).join('')}`:kind==='cherry'?`${cherry(117,145,1.3,accent)}${cherry(124,207,.9,accent)}`:kind==='orange'?wheel(124,151,30,accent,'#ffb313'):`<ellipse cx="120" cy="160" rx="24" ry="48" fill="${accent}" transform="rotate(-14 120 160)"/>${[[112,130],[126,141],[114,154],[127,168],[114,182]].map(([x,y])=>`<path d="M${x-3} ${y-3}q6-4 6 3t-6 3Z" fill="${c}"/>`).join('')}`;
 const logo=`<g transform="translate(81 133) rotate(-90)">${text(0,0,'poppi',36,'#fff9df','font-weight="900" style="font-family:Georgia,serif" textLength="110" lengthAdjust="spacingAndGlyphs" letter-spacing="-2"')}</g>`;
 const label=`${art}${logo}${text(106,59,name,7.3,'#fffbe4','font-weight="bold"')}${text(113,68,'a new kind of soda',3.9,'#fff6d8')}<circle cx="92" cy="91" r="9" fill="#fff8da"/>${text(92,90,'5g',5.6,c,'font-weight="bold"')}${text(92,96,'SUGAR',2.5,c,'font-weight="bold"')}${text(115,220,'Prebiotic Soda',5.8,'#fff6d8','font-weight="bold"')}`;
 return {slug,svg:can(slug,'poppi '+name,label,{color:c}),family:'poppi-standard-can',observations:`Exact manufacturer ${name} image inspected: ${c} can, white vertical lowercase poppi at left, ${accent} ${kind==='seal'?'round cola seal motifs':kind==='cherry'?'cherry fruit motifs':kind==='orange'?'large orange cross-section':'large yellow lemon motif dotted with pink strawberry seed shapes'}, flavor on top rim, small pale sugar badge. Lifestyle ice/background excluded; original simplified vector fruit and lettering.`};
}
const oliSpecs=[['strawberry-vanilla',['Strawberry','Vanilla'],'#f8b8a4','#e64f33','strawberry'],['orange-squeeze',['Orange','Squeeze'],'#f7d2a0','#f37e27','orange'],['classic-root-beer',['Classic','Root Beer'],'#eee1ce','#bb6d35','mugs']];
function olipop(d){const[f,lines,c,ink,kind]=d,slug='olipop-'+f;
 const logo=[...'OLIPOP'].map((ch,i)=>text([69,81,94,106,119,131][i],[102,91,86,86,91,102][i],ch,18,ink,`font-weight="900" transform="rotate(${[-27,-17,-5,5,17,27][i]} ${[69,81,94,106,119,131][i]} ${[102,91,86,86,91,102][i]})"`)).join('');
 const mug=(x,rot)=>`<g transform="translate(${x} 140) rotate(${rot})"><path d="M-10-12h20v28q-10 5-20 0Z" fill="${ink}"/><path d="M11-8q11-3 10 7t-11 9" stroke="${ink}" stroke-width="4" fill="none"/><path d="M-7-8v21m6-21v23m6-23v21" stroke="#fff0d1" stroke-width="2.5"/><ellipse cy="-12" rx="11" ry="3" fill="#fff0d1"/></g>`;
 const art=kind==='strawberry'?`${berry(93,139,1.1)}${flower(116,146,1)}${leaf(91,124,.5,'#0c664e')}`:kind==='orange'?`<circle cx="117" cy="143" r="16" fill="${ink}"/>${leaf(118,128,.65,'#1c7a4c')}${wheel(82,146,12,ink,'#f4aa48')}`:`${mug(81,-13)}${mug(119,13)}`;
 const label=`${text(100,62,'Supports Digestive Health',3.7,'#215345')}${logo}${art}${text(100,181,lines[0],16,'#124e3c','style="font-family:Georgia,serif;font-weight:bold" textLength="76" lengthAdjust="spacingAndGlyphs"')}${text(100,199,lines[1],17,'#124e3c','style="font-family:Georgia,serif;font-weight:bold"')}${text(100,213,'A New Kind of Soda',5.3,ink,'style="font-family:Georgia,serif;font-style:italic"')}${text(100,223,'12 FL OZ (355mL)',3.7,ink)}`;
 return {slug,svg:can(slug,'OLIPOP '+lines.join(' '),label,{color:c}),family:'olipop-standard-can',packageChoice:'US 12 fl oz refrigerated 9g-fiber '+lines.join(' ')+' can; representative explicitly selected formula.',observations:`Exact manufacturer 9g-fiber ${lines.join(' ')} pack image inspected: ${c} body, arched ${ink} OLIPOP, dark green serif two-line flavor, ${kind==='strawberry'?'strawberry and white vanilla flower':kind==='orange'?'whole orange and orange cross-section':'paired foamy root beer mugs'}. Silver rims. Catalog does not distinguish 6g/9g lines; documented 9g representative, no assertion of formula equivalence.`};
}

const fantaLetters=`<g fill="#fffdf3" transform="translate(57 83) rotate(-6 43 24)"><path d="M0 0h17v8H8v10h8v8H8v20H0Z"/><path fill-rule="evenodd" d="M23 7h12l10 40H34l-1-8H23l-2 8H11Zm5 10-3 14h6Z"/><path d="M40 7h10l13 22V0h11v47H63L51 26v21H40Z"/><path d="M71 0h25v10h-8v37H77V10h-6Z"/><path fill-rule="evenodd" d="M101 12h10l10 35h-10l-1-7h-9l-1 7h-9Zm4 10-2 11h5Z"/></g>`;
const fantaSpecs=[['zero-orange','orange','#ff8b10','zero'],['strawberry','strawberry','#ec1827','strawberry'],['grape','grape','#8d22ba','grape'],['pineapple','pineapple','#f4c10b','pineapple']];
function fanta(d){const[f,name,c,kind]=d,slug='fanta-'+f;
 const ink=kind==='zero'?'#f27d0c':'#fff7df';
 let fruit=kind==='grape'?grape(111,164,.9,'#8d1da4'):kind==='strawberry'?berry(111,167,1.15):kind==='pineapple'?`<g transform="translate(111 167) rotate(18)"><path d="m-8-15-9-14 13 4 3-17 7 15 11-10-4 18 11-3-13 14Z" fill="#239b39"/><ellipse rx="17" ry="23" fill="#f39816" stroke="#ffdf49" stroke-width="3"/><path d="m-13-13 23 31m-27-19 18 23m-12-43 24 33m-29 1 25-33m-21 42 28-35" stroke="#ffec75" stroke-width="2.8"/></g>`:wheel(112,163,23,'#ffac26','#f78409');
 const label=`${kind==='zero'?'<path d="M51 96h98v142H51Z" fill="#faf8ed"/>':''}<path d="M49 80 71 76 72 83 98 80 98 72 118 71 118 73 142 70 152 117q-14 33-52 35l-9-18-40 6Z" fill="${kind==='zero'?'#fffdf4':'#172d9c'}"/><g transform="translate(9 0) scale(.77 1)" ${kind==='zero'?'style="color:#18309f"':''}>${kind==='zero'?fantaLetters.replaceAll('#fffdf3','#18309f'):fantaLetters}</g>${kind==='zero'?text(100,139,'zero sugar',13,'#172d9c','font-weight="900" textLength="76" lengthAdjust="spacingAndGlyphs"'):''}${text(76,kind==='zero'?151:145,name,8.5,kind==='zero'?'#ed790b':'#fff9e7','font-weight="bold"')}${fruit}<path d="M76 170q-20-17-19-5t19 5m50 2q19-24 15-6t-15 6m-49 7q-25-2-18 9t18-9m48 0q24-9 16 6t-16-6" fill="${kind==='grape'?'#5a1278':kind==='strawberry'?'#ad1231':'#e77b18'}"/>${text(100,212,kind==='zero'?'ZERO SUGAR ORANGE SODA':name.toUpperCase()+' SODA',4.7,ink,'font-weight="bold"')}${text(100,220,'NATURALLY FLAVORED',4.1,ink,'font-weight="bold"')}`;
 return {slug,svg:can(slug,'Fanta '+(kind==='zero'?'Zero Sugar Orange':name),label,{color:c}),family:'fanta-standard-can',observations:`Exact manufacturer US ${name}${kind==='zero'?' Zero Sugar':''} can inspected: ${c} shoulder/body, ${kind==='zero'?'white lower field and white shield with blue FANTA / zero sugar':'blue angular shield and white angular FANTA'}, lowercase flavor, ${kind==='grape'?'purple grape cluster':kind==='strawberry'?'red strawberry':kind==='pineapple'?'yellow pineapple with green crown':'orange wheel'} and matching splash. Individually checked flavor graphics, standard silver rims; tiny legal copy simplified.`};
}
function colaVariant(slug){
 const coke=slug==='cherry-coke';
 const original=colas.find(r=>r.slug===(coke?'coca-cola-classic':'pepsi')).svg;
 const old=coke?'coca-cola-classic':'pepsi';
 let svg=original.replaceAll('bev-'+old+'-','bev-'+slug+'-').replace(/<title[^>]*>[^<]*<\/title>/,`<title id="bev-${slug}-title">${coke?'Cherry Coke':'Pepsi Wild Cherry'}</title>`);
 if(coke){
  svg=svg.replaceAll('#e62929','#d11f25').replace(/(<g clip-path="url\(#bev-cherry-coke-bodyclip\)">)/,'$1<path d="M51 37h98v65q-49-17-98 0Z" fill="#9b205a"/>');
  svg=svg.replace(/<text[^>]*>ORIGINAL<\/text>/,text(100,61,'Cherry',10.5,'#fffdf4','font-weight="bold" font-style="italic"')).replace(/<text[^>]*>TASTE<\/text>/,'');
 }else{
  svg=svg.replace(/(<g clip-path="url\(#bev-pepsi-wild-cherry-bodyclip\)">)/,`$1${cherry(126,68,.65)}${cherry(70,78,.6)}`);
  svg=svg.replace('</svg>',`${cherry(126,191,.62)}${text(100,214,'WILD CHERRY',7.6,'#c91e37','font-weight="900"')}${text(100,221,'FLAVORED WITH OTHER NATURAL FLAVORS',2.8,'#fff7e7')}</svg>`);
 }
 return {slug,svg,family:'cola-standard-can',observations:coke?'Exact retailer US 12oz Cherry Coke can inspected: magenta shoulder and Cherry header, red main body, large white Coca-Cola script wrapping around upper body. Photo has a large CHERRY retail annotation near base; omitted because it is an image annotation, not reliably package printing. Earlier documented retail revision selected; current manufacturer flavor page could not be retrieved.':'Exact retailer US 12oz Wild Cherry Pepsi can beside carton inspected: blue body, current red/white/blue roundel with bold black PEPSI, glossy red cherries on navy stems at shoulder and lower right, red WILD CHERRY at foot. Manufacturer product page establishes flavor; manufacturer image download failed, so exact retailer image used.'};
}
const drawings=[...poppiSpecs.map(poppi),...oliSpecs.map(olipop),...fantaSpecs.map(fanta),colaVariant('pepsi-wild-cherry'),colaVariant('cherry-coke')];
export const records=drawings.map(d=>{
 const source=evidence.find(r=>r.slug===d.slug);
 if(!source)throw Error('Missing exact product reference '+d.slug);
 return {slug:d.slug,family:d.family,packageChoice:d.packageChoice??'Representative US 12 fl oz / 355mL '+d.slug+' aluminum can, exact individually inspected package.',references:[{pageUrl:source.pageUrl,imageUrl:source.imageUrl,inspectedAt:'2026-11-10',visuallyInspected:true,observations:d.observations}],uncertainty:'Catalog gives no size; exact photographed US package chosen. Fine claims, fruit engravings and wordmarks are simplified original vectors. '+(d.slug.startsWith('olipop-')?'Explicit 9g-fiber package choice; catalog formulation remains unspecified. ':'')+'Manufacturer pages checked first; documented retailer fallback for colas. Packaging revision dates unverified. Final aesthetic approval and web-device review pending.',status:'needs-review',svg:d.svg};
});
