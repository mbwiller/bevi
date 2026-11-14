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
    "slug": "aw-root-beer",
    "pageUrl": "https://www.rootbeer.com/",
    "imageUrl": "https://www.rootbeer.com/images/catalog/aw-on.png"
  },
  {
    "slug": "aw-cream-soda",
    "pageUrl": "https://www.rootbeer.com/",
    "imageUrl": "https://www.rootbeer.com/images/catalog/cream-on.png"
  },
  {
    "slug": "canada-dry-ginger-ale",
    "pageUrl": "https://www.canadadry.com/products",
    "imageUrl": "https://www.canadadry.com/images/catalog/ginger_ale.png"
  },
  {
    "slug": "sunkist-orange",
    "pageUrl": "https://www.sunkistsoda.com/",
    "imageUrl": "https://s7d1.scene7.com/is/image/kdrp/SK_Orange_20oz_Legacy_Wet?$Dynamic-PublicURL-PNG$&wid=500&hei=1000"
  },
  {
    "slug": "crush-orange",
    "pageUrl": "https://www.crushsoda.com/",
    "imageUrl": "https://www.crushsoda.com/images/products/CRUSH_ORANGE_20.png"
  },
  {
    "slug": "crush-grape",
    "pageUrl": "https://www.crushsoda.com/",
    "imageUrl": "https://www.crushsoda.com/images/products/CRUSH_GRAPE_20.png"
  },
  {
    "slug": "squirt",
    "pageUrl": "https://www.squirtsoda.com/",
    "imageUrl": "https://www.squirtsoda.com/images/can1.png"
  },
  {
    "slug": "rc-cola",
    "pageUrl": "https://www.myrccola.com/",
    "imageUrl": "https://www.myrccola.com/images/products/RC_COLA_12.png"
  },
  {
    "slug": "ibc-root-beer",
    "pageUrl": "https://www.ibcrootbeer.com/",
    "imageUrl": "https://www.kdpproductfacts.com/smedia/kdpproductfacts.com/www/product_images/medium/IBC_ROOT_BEER_12.png"
  },
  {
    "slug": "stewarts-root-beer",
    "pageUrl": "https://www.drinkstewarts.com/",
    "imageUrl": "https://www.kdpproductfacts.com/smedia/kdpproductfacts.com/www/product_images/medium/STEWARTS_ROOT_BEER_SODA_12.png"
  },
  {
    "slug": "stewarts-orange-n-cream",
    "pageUrl": "https://www.drinkstewarts.com/",
    "imageUrl": "https://www.kdpproductfacts.com/smedia/kdpproductfacts.com/www/product_images/medium/STEWARTS_ORANGE_NCREAM_12.png"
  },
  {
    "slug": "bundaberg-ginger-beer",
    "pageUrl": "https://www.bundaberg.com/en-us/brew/ginger-beer/",
    "imageUrl": "https://www.bundaberg.com/wp-content/uploads/brew-ginger-beer-bottle-US.png"
  },
  {
    "slug": "faygo-red-pop",
    "pageUrl": "https://www.faygo.com/flavors/",
    "imageUrl": "https://www.faygo.com/wp-content/uploads/2018/06/redpop.png"
  },
  {
    "slug": "faygo-rock-and-rye",
    "pageUrl": "https://www.faygo.com/flavors/",
    "imageUrl": "https://www.faygo.com/wp-content/uploads/2018/06/rocknrye.png"
  },
  {
    "slug": "barqs-root-beer",
    "pageUrl": "https://www.kroger.com/p/barq-s-root-beer-soda/0004900003012",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0004900003012"
  },
  {
    "slug": "mug-root-beer",
    "pageUrl": "https://www.kroger.com/p/mug-root-beer-caffeine-free-soda-cans/0001200081000",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0001200081000"
  },
  {
    "slug": "vernors-ginger-ale",
    "pageUrl": "https://www.kroger.com/p/vernors-ginger-soda-cans/0007800018016",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0007800018016"
  },
  {
    "slug": "big-red",
    "pageUrl": "https://www.kroger.com/p/big-red-soda/0007181703329",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0007181703329"
  },
  {
    "slug": "mexican-coca-cola",
    "pageUrl": "https://www.kroger.com/p/coca-cola-mexican-soda-bottles/0004900007546",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0004900007546"
  },
  {
    "slug": "boylan-birch-beer",
    "pageUrl": "https://boylanbottling.com/products/original-birch-beer",
    "imageUrl": "https://boylanbottling.com/cdn/shop/products/boylan-birch-banner_1000x1000.jpg?v=1622750745"
  }
];
const date='2026-11-11';
const entry=(slug,title,svg,notes,{family='classic-soda-can',size='12 fl oz / 355mL',extra=''}={})=>{const r=evidence.find(r=>r.slug===slug);if(!r)throw Error('Missing reference '+slug);return{slug,family,packageChoice:`Representative US ${size} ${title} ${family.endsWith('-can')?'aluminum can':family.includes('pet')?'PET bottle':'glass bottle'}; exact inspected package.`,references:[{pageUrl:r.pageUrl,imageUrl:r.imageUrl,inspectedAt:date,visuallyInspected:true,observations:notes}],uncertainty:`Catalog has no size. Package and flavor individually checked; original simplified vector lettering/illustrations and fine legal copy omitted. Manufacturer first, documented retailer fallback where needed; revision dates unverified. ${extra} Final aesthetic approval and web-device review pending.`,status:'needs-review',svg};};
const leaf=(x,y,s=1,c='#1b8e46',rot=0)=>`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0Q-26 2-25-19Q-5-23 0 0" fill="${c}"/><path d="M-22-17-1-1" stroke="#a2c865" stroke-width=".7"/></g>`;
const wheel=(x,y,r,c='#f6a42b',skin='#e77813')=>`<g transform="translate(${x} ${y})"><circle r="${r}" fill="${skin}"/><circle r="${r-2}" fill="#fff1c8"/><circle r="${r-4}" fill="${c}"/>${Array.from({length:8},(_,i)=>`<path d="M0 0 ${Math.cos(i*Math.PI/4)*(r-4)} ${Math.sin(i*Math.PI/4)*(r-4)}" stroke="#fff1c8" stroke-width=".9"/>`).join('')}</g>`;
const grapes=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})">${leaf(6,-11,.7)}${[[-10,-5],[2,-9],[11,-2],[-12,7],[0,5],[10,11],[-3,17]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="7" fill="${i%2?'#92509b':'#bd76bd'}" stroke="#dec0e3" stroke-width=".65"/><circle cx="${x-2}" cy="${y-2}" r="1.4" fill="#e6c6e7" opacity=".6"/>`).join('')}</g>`;
const petCap=(c,light='#d6dcc7',w=34)=>`<rect x="${100-w/2}" y="23" width="${w}" height="18" rx="3" fill="${c}"/><ellipse cx="100" cy="24" rx="${w/2}" ry="3" fill="${light}"/>${Array.from({length:13},(_,i)=>`<path d="M${102-w/2+i*(w-4)/12} 27v11" stroke="${light}" stroke-width=".7" opacity=".4"/>`).join('')}<path d="M${99-w/2} 42h${w+2}" stroke="${c}" stroke-width="2"/>`;
const crownCap=(color='#9a5728',w=26)=>`<path d="M${100-w/2} 22q${w/2}-4 ${w} 0l2 7-3 2-3-1-3 1-3-1-3 1-3-1-3 1-4-2Z" fill="${color}" stroke="#b4b8a4" stroke-width=".6"/><ellipse cx="100" cy="22" rx="${w/2}" ry="2.7" fill="${color}"/><path d="M${101-w/2} 25h${w-2}" stroke="#fff7d3" stroke-opacity=".35" stroke-width="1"/>`;
function bottle(slug,title,shape,label,{c='#7e4024',light='#bf8045',dark='#351b16',cap='glass',capColor='#aa6133',defs='',r=52}={}){
 const liquid=`<linearGradient id="__ID__liquid"><stop stop-color="${dark}"/><stop offset=".25" stop-color="${light}"/><stop offset=".58" stop-color="${c}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
 return wrap(slug,title,`${shadow(r)}<path d="${shape}" fill="${ref('liquid')}" stroke="${dark}" stroke-width=".7"/><g clip-path="${ref('bottleclip')}">${label}<path d="${shape}" fill="${ref('glass')}" opacity=".45"/><path d="${shape}" fill="${ref('shade')}" opacity=".65"/>${drops(69,61,65,160,24)}<path d="M90 39v24q-1 21-18 41v111" fill="none" stroke="#fff5de" stroke-opacity=".3" stroke-width="2.6"/><path d="M112 53q2 28 16 47v113" fill="none" stroke="#fff5de" stroke-opacity=".17" stroke-width="1.4"/></g>${cap==='pet'?petCap(capColor,({'#a4612d':'#c78b50','#1d548a':'#4988b9','#0a875b':'#30ac7e','#d0d4c8':'#e2e5dc'})[capColor]??'#dedfcf'):cap==='ring'?`${crownCap(capColor,34)}<path d="M114 25q21 1 16 13-13-2-16-13Z" fill="none" stroke="#b43127" stroke-width="2"/><path d="M117 26q12 2 10 9" fill="none" stroke="#eee3bd" stroke-width="1"/>`:crownCap(capColor)}<path d="M71 226q29 9 58 0" stroke="#fff7dc" stroke-opacity=".2" stroke-width="1.5" fill="none"/>`,`<clipPath id="__ID__bottleclip"><path d="${shape}"/></clipPath>${liquid}${defs}`);
}
const awShape='M82 39h36v16q0 12 14 25 18 20 18 46v88l-5 15-15 7-14-2-16 4-16-4-14 2-15-7-5-15v-88q0-26 18-46 14-13 14-25Z';
function aw(cream=false){const slug=cream?'aw-cream-soda':'aw-root-beer',title=cream?'A&W Cream Soda':'A&W Root Beer',creamC='#d7b96e',brown='#613119';
 const wood=cream?'':Array.from({length:14},(_,i)=>`<path d="M${53+i*7} 118v83" stroke="${i%2?'#b1936d':'#725239'}" stroke-width="1" opacity=".6"/>`).join('');
 const label=`<path d="M52 115h96v87H52Z" fill="${cream?creamC:'#8f7250'}"/>${wood}<path d="M52 115q48 2 96 0v9q-48-4-96 4Z" fill="#fff3c6"/>${!cream?'<path d="M55 115q16-8 28-1t30 0q16-7 31 3v16q-17 3-32-2t-34 3l-23 2Z" fill="#f5e2b2"/>':''}<g transform="rotate(-13 100 154)"><ellipse cx="100" cy="154" rx="36" ry="21" fill="${brown}" stroke="#f6dfb0" stroke-width="1.5"/><ellipse cx="100" cy="154" rx="32" ry="18" fill="#fdf3d2"/><path d="M67 154q9-19 31-17l6 32q-25 9-37-15Z" fill="#b44d26"/>${text(100,163,'A&W',28,brown,'style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="61" lengthAdjust="spacingAndGlyphs" stroke="#fff8e3" stroke-width=".7" paint-order="stroke"')}</g>${text(100,190,cream?'Cream Soda':'ROOT BEER',cream?8.5:7.5,cream?brown:'#fff3ce',cream?'style="font-family:Georgia,serif;font-weight:bold"':'font-weight="bold"')}${!cream?text(100,197,'SINCE 1919',3.5,'#fff3ce'):''}<path d="M54 202q46 3 92 0" stroke="#f9e6b9" stroke-width="2"/>${text(100,88,'A&W',12,'#c3905c','font-style="italic" opacity=".35"')}`;
 return entry(slug,title,bottle(slug,title,awShape,label,{c:cream?'#cf8b28':'#542b1b',light:cream?'#f4b54a':'#8f4d2d',dark:cream?'#9b5b1c':'#281a13',cap:'pet',capColor:'#a4612d',r:59}),`Exact manufacturer ${title} bottle inspected: brown ribbed screw cap, broad rounded PET with molded A&W shoulder and lobed base; ${cream?'transparent golden soda, pale cream label':'dark amber root beer, wooden-barrel label and creamy foam header'}, oval white/brown/orange A&W and ${cream?'brown Cream Soda':'white ROOT BEER'}. Chosen manufacturer20oz bottle rather than assuming a can.`,{family:'aw-pet-bottle',size:'20 fl oz / 591mL'});
}
const contouredShape='M84 39h32v15q0 9 11 17 20 17 21 43v25q0 13-8 23l-5 19q-2 10 4 24l8 14q2 9-5 15l-11 2-10-3-21 5-21-5-10 3-11-2q-7-6-5-15l8-14q6-14 4-24l-5-19q-8-10-8-23v-25q1-26 21-43 11-8 11-17Z';
function citrusPet(grape=false,sunkist=false){const slug=sunkist?'sunkist-orange':grape?'crush-grape':'crush-orange',title=sunkist?'Sunkist Orange':grape?'Crush Grape':'Crush Orange',c=grape?'#4c2859':'#f6a226';
 const fruit=grape?`${grapes(63,100,.6)}${grapes(138,112,.7)}${grapes(77,153,.55)}`:`${wheel(64,100,10)}${leaf(72,109,.45)}${wheel(140,142,11)}${leaf(129,99,.45)}${wheel(99,151,8)}`;
 let label=`<path d="M51 94h98v64H51Z" fill="${grape?'#9353a3':'#f5a026'}"/>${fruit}`;
 if(sunkist)label=`<path d="M51 92h98v57H51Z" fill="#ef9a25"/><circle cx="91" cy="106" r="14" fill="#ffe849"/>${Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return `<path d="M${91+Math.cos(a)*17} ${106+Math.sin(a)*17}l${Math.cos(a)*6} ${Math.sin(a)*6}" stroke="#ffd74a" stroke-width="1.8"/>`}).join('')}${text(101,128,'Sunkist',25,'#113b6c','style="font-family:Georgia,serif;font-style:italic;font-weight:bold" textLength="80" lengthAdjust="spacingAndGlyphs" stroke="#fff5d8" stroke-width="2.3" paint-order="stroke" transform="rotate(-9 101 128)"')}${text(119,141,'Orange',7.5,'#143b66','font-weight="bold" stroke="#fff7e0" stroke-width="1.5" paint-order="stroke"')}${wheel(140,143,7)}`;
 else label+=`${text(100,132,'Crush',32,'#fffdf0','font-weight="900" letter-spacing="-1.2" textLength="83" lengthAdjust="spacingAndGlyphs" stroke="#14916b" stroke-width="2.4" paint-order="stroke" transform="rotate(-5 100 132)"')}${text(100,147,grape?'Grape':'Orange',10,'#fff6d3','style="font-family:Georgia,serif;font-weight:bold;font-style:italic"')}`;
 label+=`<path d="M62 175q38 5 76 0m-73 11q35 5 70 0m-69 12q34 5 68 0" stroke="#fff3c9" stroke-opacity=".17" fill="none" stroke-width="1.8"/>`;
 return entry(slug,title,bottle(slug,title,contouredShape,label,{c,light:grape?'#80528a':'#ffc04d',dark:grape?'#2d1a35':'#db7b16',cap:'pet',capColor:sunkist?'#1d548a':'#0a875b',r:57}),`Exact manufacturer20oz ${title} PET inspected: sculpted waist, lobed base, ${sunkist?'blue':'green'} screw cap, ${grape?'dark purple':'bright orange'} soda. ${sunkist?'Orange wrap with yellow sunburst and navy/white script Sunkist, Orange below':'Full wrap with '+(grape?'purple grape clusters':'orange slices and leaves')+', large white Crush outlined green and flavor beneath'}. Independent variant colors and fruit motifs preserved.`,{family:'citrus-soda-pet-bottle',size:'20 fl oz / 591mL'});
}
function canada(){const slug='canada-dry-ginger-ale';const waves=Array.from({length:17},(_,i)=>`<path d="M51 ${45+i*11}q20-8 32 0t31 0 36 0" stroke="${i%2?'#e6c93c':'#6d9e36'}" stroke-width="${i%2?1:.55}" stroke-dasharray="${i%2?'1 2':'none'}" fill="none" opacity=".8"/>`).join('');const label=`${waves}<path d="M65 91q35 15 70 0l5 18-4 42q-4 19-36 28-32-9-36-28l-4-42Z" fill="#f9f5da" stroke="#e7d341" stroke-width="2.4"/>${[78,91,109,122].map(x=>`<path d="M${x} 99q${(100-x)/3} 34 0 63" stroke="#e5cf58" stroke-width=".7" fill="none"/>`).join('')}<path d="M65 118h70M64 145h72" stroke="#e5cf58" stroke-width=".7"/>${text(100,115,'SINCE 1904',4.7,'#16684b','font-weight="bold" letter-spacing=".8"')}${text(100,137,'CANADA',20,'#c62e3a','font-weight="900" textLength="78" lengthAdjust="spacingAndGlyphs" stroke="#fffcef" stroke-width="1.1" paint-order="stroke"')}${text(100,157,'DRY',22,'#c62e3a','font-weight="900" stroke="#fffcef" stroke-width="1.1" paint-order="stroke"')}<path d="m80 92-4-10 9 2 2-10 9 10 4-15 6 15 9-10 1 11 10-3-5 11Z" fill="none" stroke="#ecd83f" stroke-width="2"/>${text(100,197,'GINGER ALE',11,'#fffbe4','font-weight="bold" letter-spacing=".6"')}`;return entry(slug,'Canada Dry Ginger Ale',can(slug,'Canada Dry Ginger Ale',label,{color:'#0b6543'}),'Exact manufacturer green12oz can inspected: dark green body with fine gold/green wavy contour lines and dots, gold crown, cream globe/shield, red CANADA DRY, white GINGER ALE below. Silver rims. This is Original Ginger Ale, not fruit splash or Zero Sugar.');}
function rc(){const slug='rc-cola';const label=`<path d="M51 40h98v91q-49 26-98 0Z" fill="#f3f5ec"/>${text(100,67,'Me and My',11,'#138cb1','style="font-family:Georgia,serif;font-style:italic;font-weight:bold"')}${text(100,117,'RC',63,'#d9442b','style="font-family:Georgia,serif;font-style:italic;font-weight:bold" textLength="96" lengthAdjust="spacingAndGlyphs"')}${text(100,158,'ROYAL CROWN COLA',5.7,'#f3f9e8','font-weight="bold" letter-spacing=".4"')}`;return entry(slug,'RC Cola',can(slug,'RC Cola',label,{color:'#079bbf'}),'Exact US manufacturer RC COLA12 image inspected: cyan lower body, white/silver upper curved field, blue Me and My, enormous red italic RC, curved white ROYAL CROWN COLA. Silver rims; reference label is representative older US package rather than international red/blue or new blue can.');}
function squirt(){const slug='squirt';const label=`${leaf(91,102,.85,'#60a22d',-50)}<path d="M97 88q-17-21-13-27 11-9 14 9m-2 20q-11-3-15 3" stroke="#fff8c1" stroke-width="1.6" fill="none"/>${wheel(72,195,18,'#e3b6ad','#b5bf36')}${text(111,151,'Squirt',29,'#d92e28','style="font-family:Georgia,serif;font-style:italic;font-weight:bold" textLength="131" lengthAdjust="spacingAndGlyphs" stroke="#fff4cc" stroke-width="1.1" paint-order="stroke" transform="rotate(-62 111 151)"')}${text(117,215,'Grapefruit',7.2,'#4f932e','font-weight="bold"')}${text(128,224,'Soda',6.5,'#4f932e','font-weight="bold"')}`;return entry(slug,'Squirt',can(slug,'Squirt',label,{color:'#f3dc1c'}),'Exact manufacturer Original Squirt12oz can inspected: bright yellow field, red diagonal script Squirt outlined pale, small green/lime grapefruit leaf/motif at upper-left, grapefruit slice low-left and green Grapefruit Soda footer. Not Ruby Red or Zero Sugar.');}
function barqs(){const slug='barqs-root-beer';const lattice=Array.from({length:19},(_,i)=>`<path d="M${30+i*10} 43l-100 190m${-65+i*10} 43 100 190" stroke="#adb5ae" stroke-width=".65" fill="none" opacity=".42"/>`).join('');const label=`${lattice}${text(100,130,"Barq’s",30,'#fffdf0','style="font-family:Georgia,serif;font-style:italic;font-weight:bold" textLength="82" lengthAdjust="spacingAndGlyphs" stroke="#1c332b" stroke-width="3.4" paint-order="stroke" transform="rotate(-13 100 130)"')}<g transform="translate(110 148)">${leaf(-5,-1,.5,'#1c6741',-20)}<circle cx="-8" cy="3" r="4" fill="#ce2440"/><circle cx="0" cy="3" r="4" fill="#e62942"/><circle cx="-3" cy="9" r="4" fill="#bf1d39"/></g>${text(100,174,'ROOT BEER',9,'#20382e','font-weight="900" letter-spacing=".5"')}`;return entry(slug,"Barq’s Root Beer",can(slug,"Barq’s Root Beer",label,{color:ref('metal')}),'Exact retailer US12oz Barq’s can inspected beside its carton: silver diamond-lattice body, slanted white script outlined black/green, small red and green flourish beneath, black ROOT BEER. Manufacturer product page unavailable. No caffeine/formulation claim is drawn.');}
function bulldog(){return `<g transform="translate(100 152)"><path d="M-25-11q-6-18 4-22 13-3 18 4 15-9 26 3 9 15-2 29l-7 11h-28l-9-12Z" fill="#c29055" stroke="#5b371f" stroke-width="1.2"/><path d="M-22-19q-9-15-15-5-3 9 6 23l12-8m38-14q10-13 14-3 3 10-5 22l-10-7" fill="#895b34" stroke="#5b371f" stroke-width="1"/><path d="M-20-8q4-18 18-7 13-10 24 7-1 17-18 18-17 1-24-7Z" fill="#ead6b5"/><ellipse cx="2" cy="-7" rx="8" ry="5" fill="#4a3022"/><path d="m2-4-1 7-6 3m6-3 7 3M-14-19l9-3m11 0 9 3" fill="none" stroke="#4a3022" stroke-width="2" stroke-linecap="round"/><circle cx="-10" cy="-16" r="1.8" fill="#31271e"/><circle cx="12" cy="-16" r="1.8" fill="#31271e"/><path d="M-8 8h20l-2 7H-6Z" fill="#714025"/></g>`;}
function mug(){const slug='mug-root-beer';const label=`<path d="M51 40h98v61q-49-13-98 0Z" fill="#f0d7a9"/><path d="M54 63q47-16 92-1v42q-46-8-92 0Z" fill="#a62321" stroke="#dfb35b" stroke-width="1.5"/>${text(100,99,'MUG',38,'#fff4cf','font-weight="900" textLength="82" lengthAdjust="spacingAndGlyphs" stroke="#c8963f" stroke-width="1.8" paint-order="stroke"')}${bulldog()}<path d="M56 170q44-9 88 0v23q-44-4-88 0Z" fill="#8b4a27" stroke="#d6a959" stroke-width="1"/>${text(100,186,'ROOT BEER',10,'#fff1c8','font-weight="900"')}${text(100,216,'NO CAFFEINE',6.5,'#e6cc58','font-weight="bold"')}`;return entry(slug,'Mug Root Beer',can(slug,'Mug Root Beer',label,{color:'#ac733a'}),'Exact retailer US12oz Mug Original can inspected: brown/tan barrel-like body with cream foamy shoulder, massive cream/gold MUG on red field, tan bulldog face in center, ROOT BEER below and yellow NO CAFFEINE footer. Dog/lettering simplified as original vector shapes; external carton excluded.');}
function vernors(){const slug='vernors-ginger-ale';const bands=[51,220].map(y=>`<path d="M52 ${y-8}h96v13H52Z" fill="#d3ba36"/>${Array.from({length:9},(_,i)=>`<path d="m${55+i*11} ${y-5} 4 4-4 4-4-4Z" fill="#537e25"/>`).join('')}`).join('');const lines=Array.from({length:32},(_,i)=>`<path d="M${54+i*3} 60v150" stroke="#e2d87d" stroke-width=".35" opacity=".25"/>`).join('');const label=`${lines}${bands}${text(110,145,'Vernors',26,'#fff9dc','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="109" lengthAdjust="spacingAndGlyphs" stroke="#153d31" stroke-width="2.5" paint-order="stroke" transform="rotate(-51 110 145)"')}${text(116,183,'The Original',7,'#fff2bd','style="font-family:Georgia,serif;font-style:italic"')}${text(119,192,'Ginger Soda',7,'#fff2bd','style="font-family:Georgia,serif;font-style:italic"')}`;return entry(slug,'Vernors Ginger Soda',can(slug,'Vernors Ginger Soda',label,{color:'#12694b'}),'Exact retailer12oz Vernors Original ginger soda can inspected: dark green body, subtle vertical texture, yellow decorative top/base bands, large diagonal cream Vernors outlined dark green, small The Original Ginger Soda below. Separate from Diet; retail image12OZ annotation excluded.');}
function bigred(){const slug='big-red';const bubbles=Array.from({length:38},(_,i)=>`<circle cx="${57+i*19%85}" cy="${47+i*23%170}" r="${i%3?1.1:2.2}" fill="none" stroke="#f3baa1" stroke-width=".55" opacity=".5"/>`).join('');const label=`${bubbles}${text(100,121,'BIG',35,'#fff6df','font-weight="900" font-style="italic" textLength="75" lengthAdjust="spacingAndGlyphs" stroke="#213550" stroke-width="2.5" paint-order="stroke" transform="rotate(-12 100 121)"')}${text(100,157,'RED',35,'#fff6df','font-weight="900" font-style="italic" textLength="75" lengthAdjust="spacingAndGlyphs" stroke="#213550" stroke-width="2.5" paint-order="stroke" transform="rotate(-12 100 157)"')}<circle cx="118" cy="197" r="9" fill="#22364e" stroke="#e0d6b2" stroke-width="1.5"/>${text(118,197,'SINCE',2.6,'#fff2d3')}${text(118,202,'1937',4,'#fff2d3','font-weight="bold"')}`;return entry(slug,'Big Red',can(slug,'Big Red',label,{color:'#b9343e'}),'Exact retailer US12oz Big Red regular can inspected beside carton: red body with tiny gold/red bubbles, stacked italic white BIG RED with navy shadow outline, small round since1937 seal lower-right. External12OZ retail annotation omitted; not Big Red Zero.');}
const glassShape='M87 28h26l2 41q1 13 14 34 9 14 9 38v82q0 13-38 13t-38-13v-82q0-24 9-38 13-21 14-34Z';
function ibc(){const slug='ibc-root-beer';const label=`<path d="M85 45h30v22H85Z" fill="#6b2c21"/>${text(100,58,'IBC',10,'#fff5dc','style="font-family:Georgia,serif;font-weight:bold"')}${text(100,64,'Since 1919',3,'#fff5dc','style="font-family:Georgia,serif;font-style:italic"')}<path d="M84 143q16-13 32 0l4 32H80Z" fill="#bd302c" stroke="#f7ecc6" stroke-width="1.5"/>${text(100,162,'IBC',22,'#fff8df','style="font-family:Georgia,serif;font-weight:bold" stroke="#fff8df" stroke-width=".4"') }<path d="M73 169q27-7 54 0l-2 14q-25-6-50 0Z" fill="#a57b39" stroke="#fff1c6" stroke-width="1.2"/>${text(100,180,'ROOT BEER',8.5,'#fff8d6','font-weight="900"')}${text(100,194,'Since 1919',5.2,'#fff3cc','style="font-family:Georgia,serif;font-style:italic"')}`;return entry(slug,'IBC Root Beer',bottle(slug,'IBC Root Beer',glassShape,label,{c:'#4c2419',light:'#783e27',dark:'#291a15',capColor:'#b23e2d',r:49}),'Exact manufacturer12oz IBC Root Beer glass bottle inspected: amber long-neck bottle, rust-red crown cap, small burgundy IBC neck label, red/cream shield with large white serif IBC, gold ROOT BEER ribbon and Since1919 below. Bottle retained; no generic can substitution.',{family:'ibc-glass-bottle'});}
const stewartShape='M88 28h24l3 50q1 14 13 40 8 15 8 32v73q0 13-36 13t-36-13v-73q0-17 8-32 12-26 13-40Z';
function stewarts(orange=false){const slug=orange?'stewarts-orange-n-cream':'stewarts-root-beer',title=orange?'Stewart’s Orange ’n Cream':'Stewart’s Root Beer',accent=orange?'#168552':'#df6832';
 const label=`<path d="M86 62l14-7 15 7-15 7Z" fill="${accent}" stroke="#fbf2d2" stroke-width=".8"/>${text(100,64,'1924',5.5,'#fff6dd','font-weight="bold"')}${text(100,132,orange?'Orange ’n Cream':'Root Beer',orange?7.5:9,'#fff7df','style="font-family:Georgia,serif;font-weight:bold"')}<path d="M65 151 99 135 136 151 130 167 100 176 69 167Z" fill="${accent}" stroke="#fff3cf" stroke-width="1.2"/>${text(100,163,'Stewart’s',18,'#fff4d6','style="font-family:Georgia,serif;font-style:italic;font-weight:bold" textLength="68" lengthAdjust="spacingAndGlyphs" stroke="#1f3527" stroke-width="1.9" paint-order="stroke"')}${text(100,176,'Fountain Classics',5.4,'#fff4d6','style="font-family:Georgia,serif;font-style:italic"')}${orange?`<g transform="translate(105 201) rotate(-25)"><path d="M-9-14q9-6 18 0v23H-9Z" fill="#f09328" stroke="#fff2cc" stroke-width="1.4"/><path d="M-5-11v16m6-17v17m-1 4v12" stroke="#fff3c9" stroke-width="1.7"/></g>`:`<g transform="translate(103 202) rotate(-20)"><path d="M-10-12h20v24q-10 5-20 0Z" fill="#93613a" stroke="#f3e5c5" stroke-width="1.2"/><path d="M11-7q10-4 10 5t-10 9" stroke="#f3e5c5" stroke-width="2.3" fill="none"/><path d="M-7-9v18m5-18v20m6-20v18" stroke="#f3e5c5" stroke-width="1"/><ellipse cy="-13" rx="12" ry="3" fill="#f3e5c5"/></g>`}`;
 return entry(slug,title,bottle(slug,title,stewartShape,label,{c:orange?'#e99e33':'#352219',light:orange?'#fbc153':'#5d3a26',dark:orange?'#b56e25':'#1e1714',capColor:orange?'#14805a':'#d45d28',r:48}),`Exact manufacturer12oz ${title} glass bottle inspected: long slim neck and modest curved shoulder, ${orange?'clear amber-orange soda, green crown cap/1924 diamond':'very dark brown soda, orange crown cap/1924 diamond'}, embossed Stewart’s glass shoulder, white flavor above ${orange?'green':'orange'} lozenge/script label, Fountain Classics, ${orange?'orange creamsicle illustration':'tilted foamy root-beer mug'} below. Original non-diet variant; label engraving/filler simplified.`,{family:'stewarts-glass-bottle'});
}
function bundaberg(){const slug='bundaberg-ginger-beer',shape='M82 29h36v10q1 10 18 23 18 17 18 48v100q0 25-54 25t-54-25V110q0-31 18-48 17-13 18-23Z';const label=`<path d="M48 128q52-12 104 0v72q-52 20-104 0Z" fill="#e4a93f" stroke="#54381b" stroke-width="1.4"/><path d="M51 131q49-12 98 0v66q-49 19-98 0Z" fill="none" stroke="#8a5b28" stroke-width=".8"/>${text(100,146,'BUNDABERG',16,'#282919','style="font-family:Georgia,serif;font-weight:bold" textLength="91" lengthAdjust="spacingAndGlyphs"')}<g transform="translate(100 169)"><path d="M-15-12q15-8 30 0v23q-15 8-30 0Z" fill="#b57c39" stroke="#6c4b25" stroke-width=".8"/><path d="M-12-9v19m8-22v25m9-25v25m8-22v19M-15-6q15 6 30 0m-30 12q15 6 30 0" fill="none" stroke="#6b4c2b" stroke-width="1.1"/></g><path d="M54 174q46 9 92 0l-5 17q-41 10-82 0Z" fill="#ba2c2b"/>${text(100,187,'GINGER BEER',9,'#fff4d8','font-weight="900"')}${text(97,207,'AUSTRALIAN',4.8,'#3f2c18','font-weight="bold"')}${text(97,213,'FAMILY OWNED',4.8,'#3f2c18','font-weight="bold"')}<circle cx="136" cy="206" r="10" fill="#e9b94e" stroke="#85652a" stroke-width=".8"/>${text(136,206,'3',8,'#694920','font-weight="bold"')}${text(136,212,'DAYS',3.7,'#694920','font-weight="bold"')}<path d="M82 30q18 5 36 0m-32 4q14 4 28 0" fill="none" stroke="#372a18" stroke-width="2"/><path d="M114 28q18 3 17 12-12 1-13-10Z" fill="none" stroke="#a52b25" stroke-width="2"/>`;
 return entry(slug,'Bundaberg Ginger Beer',bottle(slug,'Bundaberg Ginger Beer',shape,label,{c:'#8b471a',light:'#c9882a',dark:'#4a2b16',capColor:'#d5a037',cap:'ring',r:65}),'Exact US manufacturer375mL/12.7oz amber stubby glass bottle inspected: short ring-pull gold cap, broad rounded shoulder, amber glass, yellow/tan bordered label with arched black Bundaberg, central wooden barrel, red GINGER BEER banner, Australian Family Owned and3Days brew badge. Sediment/glass texture simplified; no can or diet substitution.',{family:'bundaberg-stubby-glass-bottle',size:'12.7 fl oz / 375mL'});
}
const faygoShape='M84 39h32v11q0 7 14 23 16 19 16 49v92l-5 17-13 5-12-3-16 4-16-4-12 3-13-5-5-17v-92q0-30 16-49 14-16 14-23Z';
function faygo(rock=false){const slug=rock?'faygo-rock-and-rye':'faygo-red-pop',title=rock?'Faygo Rock & Rye':'Faygo Redpop';const pattern=Array.from({length:22},(_,i)=>`<path d="m${57+i*17%84} ${123+i*23%87} 6-3 6 6-5 3 3 5-6-1Z" stroke="${rock?'#2c3653':'#8b2030'}" stroke-width="1" fill="none" opacity=".55"/>`).join('');const label=`<path d="M53 112h94v105H53Z" fill="#c52135"/>${pattern}${rock?'<path d="M55 197 131 121l15 18-75 77Z" fill="#243252" opacity=".8"/>':''}<path d="M53 112h94v15H53Z" fill="#e8d12a"/>${text(100,123,'Big 24 oz.',11,'#c4242b','font-weight="900" textLength="84" lengthAdjust="spacingAndGlyphs"')}${text(100,169,'Faygo',34,'#dedddd','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="91" lengthAdjust="spacingAndGlyphs" stroke="#3b2639" stroke-width="2.4" paint-order="stroke" transform="rotate(-24 100 169)"')}${text(100,192,rock?'Rock & Rye':'Redpop',rock?13:16,'#e8d735','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" transform="rotate(-24 100 192)"')}${!rock?'<path d="M64 138q-9-13-7-18 6-8 13 1 11-8 12 1l-12 22Z" fill="#e6413a" stroke="#d7de30" stroke-width=".8"/>':''}`;
 return entry(slug,title,bottle(slug,title,faygoShape,label,{c:rock?'#6e1d25':'#e62532',light:rock?'#b53539':'#f74448',dark:rock?'#3b1e23':'#a31a26',cap:'pet',capColor:'#d0d4c8',r:56}),`Exact manufacturer24oz ${title} PET individually inspected: gray/white screw cap, red ${rock?'dark brown-red':'bright ruby-red'} soda, broad cylindrical body/lobed base, yellow Big24oz label band, diagonal silver/white Faygo outlined dark, ${rock?'navy/red patterned lower field with yellow Rock & Rye':'red strawberry graphic and yellow Redpop'}. Exact24oz package chosen; no zero-sugar formula substituted.`,{family:'faygo-pet-bottle',size:'24 fl oz / 710mL'});
}
const cokeBottleShape='M89 28h22l2 42q0 14 12 31 9 12 9 29v19q-1 20-8 40l-1 12 8 22q3 13-33 14t-33-14l8-22-1-12q-7-20-8-40v-19q0-17 9-29 12-17 12-31Z';
function mexicanCoke(){const slug='mexican-coca-cola';const svg=colas.find(r=>r.slug==='coca-cola-classic').svg;const match=svg.match(/<g transform="translate\(-48 65\) scale\(1.4 1.65\)" fill="#fffdf4">([\s\S]*?)<\/g>/);if(!match)throw Error('Missing frozen Coca-Cola lettering');const label=`<path d="M87 33h26v23H87Z" fill="#e6e9d7" opacity=".35"/><path d="M79 78q21 7 42 0m-45 12q24 7 48 0" fill="none" stroke="#bfcdb7" stroke-opacity=".32" stroke-width="1.2"/><path d="M66 135q34 3 68 0v34q-34 7-68 0Z" fill="#d32d31"/><g transform="translate(44 139) scale(.53 .6)" fill="#fff9e6">${match[1]}</g>${[77,86,95,105,114,123].map(x=>`<path d="M${x} 180q${(100-x)*.18} 22 ${(100-x)*.25} 43" fill="none" stroke="#b4c3a5" stroke-width="1.2" opacity=".25"/>`).join('')}`;return entry(slug,'Coca-Cola de Mexico',bottle(slug,'Coca-Cola de Mexico',cokeBottleShape,label,{c:'#4a2417',light:'#83502d',dark:'#291b14',capColor:'#d6342f',r:48}),'Exact retailer12oz Coca-Cola de Mexico glass bottle inspected beside4-pack: red crown cap, long clear neck with ridges, curved contour shoulder/waist and fluted base, dark cola, red central wrap with white script. Mexico retail annotation excluded. Imported de Mexico identity retained, not newly introduced domestic cane-sugar Coke.',{family:'mexican-cola-contour-glass-bottle'});}
const boylanShape='M88 28h24l3 41q1 19 9 45 9 22 9 44v65q0 13-33 13t-33-13v-65q0-22 9-44 8-26 9-45Z';
function boylan(){const slug='boylan-birch-beer';const label=`${text(100,109,'BOYLAN',8,'#6c6656','font-weight="900" opacity=".45"')}${text(100,120,'BOTTLING CO.',5.2,'#6c6656','font-weight="bold" opacity=".35"')}<ellipse cx="100" cy="183" rx="29" ry="37" fill="#151b18" stroke="#ad8035" stroke-width="1.7"/><ellipse cx="100" cy="185" rx="22" ry="28" fill="#a48243"/>${text(100,159,'BOYLAN',7.5,'#f7edd5','font-weight="bold" letter-spacing="1.1"')}${text(100,190,'BIRCH BEER',8.6,'#fff4d8','font-weight="900" textLength="39" lengthAdjust="spacingAndGlyphs"')}${text(100,200,'CANE SUGAR',4.6,'#fff4d8','font-weight="bold" letter-spacing=".7"')}${text(100,211,'12 FL OZ',3,'#fff4d8')}${text(100,218,'BOTTLING CO.',5.9,'#f7edd5','font-weight="bold" letter-spacing=".6"')}`;return entry(slug,'Boylan Original Birch Beer',bottle(slug,'Boylan Original Birch Beer',boylanShape,label,{c:'#251e18',light:'#40382b',dark:'#151813',capColor:'#20221c',r:47}),'Exact manufacturer product photo inspected: very dark amber long-neck glass bottle, black crown cap, embossed BOYLAN BOTTLING CO shoulder, black/gold oval front label with white BOYLAN at top, gold central field and white BIRCH BEER / CANE SUGAR, white BOTTLING CO lower ring. Manufacturer labels bottle12fl oz; background/carrier/birch wood excluded. Original Birch Beer, not Creamy Red Birch or Root Beer.',{family:'boylan-glass-bottle'});}
export const records=[aw(false),aw(true),citrusPet(false,true),citrusPet(false,false),citrusPet(true,false),canada(),rc(),squirt(),barqs(),mug(),vernors(),bigred(),ibc(),stewarts(false),stewarts(true),bundaberg(),faygo(false),faygo(true),mexicanCoke(),boylan()];
