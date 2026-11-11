import {wrap,shadow,ref,text} from '../style.mjs';
function can(slug,title,label,{slim=false,narrow=false,color,defs='',tab='#e6e8de'}={}) {
  const l=narrow?67:slim?60:58,r=200-l,t=slim?24:26,rx=100-l-6;
  const body=`M${l+6} ${t}Q100 ${t-8} ${r-6} ${t}L${r} ${t+16}V220Q${r} 233 100 233T${l} 220V${t+16}Z`;
  return wrap(slug,title,`${shadow(slim?49:54)}<path d="${body}" fill="${color}"/>
<g clip-path="${ref('bodyclip')}">${label}<path d="${body}" fill="${ref('shade')}" opacity=".8"/>
<path d="M${l+8} ${t+22}V214" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width="2.8"/>
${Array.from({length:25},(_,i)=>`<ellipse cx="${l+9+i*19%(r-l-16)}" cy="${t+21+i*37%163}" rx="${i%4?.5:.9}" ry="${i%4?.8:1.4}" fill="#fff" opacity=".2"/>`).join('')}</g>
<ellipse cx="100" cy="${t}" rx="${rx}" ry="7" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="${t}" rx="${rx-4}" ry="4.6" fill="none" stroke="#8d9892" stroke-width=".7"/>
<ellipse cx="104" cy="${t+1}" rx="7" ry="2.8" fill="#657169"/>
<path d="M94 ${t-2}h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="${tab}" stroke-width="2.2"/>
<path d="M${l+3} 226q${(r-l-6)/2} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M${l+6} 230q${(r-l-12)/2} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
`<clipPath id="__ID__bodyclip"><path d="${body}"/></clipPath>${defs}`);
}
const alaniScript=`<g transform="translate(105 174) rotate(-90) scale(.8 .65)" fill="none" stroke="#5cdbbc" stroke-width="5.3" stroke-linecap="round" stroke-linejoin="round">
<path d="M0 9Q17-14 31-22L14 12M9 0 27-2M16 11q13-3 27-31 7-13 0-11-10 6-12 29-1 16 11 3M43 0q12-16 18-7 1 10-11 13-10 0-6-9M60-7l-4 15q4 2 12-10l8-8-6 18q3 3 11-6M82-3 76 9q1 4 11-5"/>
<path d="m88-15 1-1"/>
</g>`;

const evidence=[
  {
    "slug": "celsius-arctic-vibe",
    "pageUrl": "https://www.celsius.com/products/",
    "imageUrl": "https://www.celsius.com/wp-content/uploads/2023/08/Arctic-Vibe-front.png"
  },
  {
    "slug": "celsius-sparkling-peach-vibe",
    "pageUrl": "https://www.celsius.com/products/",
    "imageUrl": "https://www.celsius.com/wp-content/uploads/2023/08/Peach-Vibe-front.png"
  },
  {
    "slug": "celsius-kiwi-guava",
    "pageUrl": "https://www.celsius.com/products/",
    "imageUrl": "https://www.celsius.com/wp-content/uploads/2023/08/Kiwi-Guava-front.png"
  },
  {
    "slug": "celsius-sparkling-wild-berry",
    "pageUrl": "https://www.celsius.com/products/",
    "imageUrl": "https://www.celsius.com/wp-content/uploads/2023/08/Wild-Berry-front.png"
  },
  {
    "slug": "celsius-sparkling-cola",
    "pageUrl": "https://www.celsius.com/products/",
    "imageUrl": "https://www.celsius.com/wp-content/uploads/2023/08/Cola-front.png"
  },
  {
    "slug": "alani-nu-breezeberry",
    "pageUrl": "https://www.alaninu.com/products/energy-drink-breezeberry",
    "imageUrl": "https://www.alaninu.com/cdn/shop/files/stretch_AN-Website-12oz-PDP-BRZ-01_1_v1.png?v=1782928623&width=1000"
  },
  {
    "slug": "alani-nu-cosmic-stardust",
    "pageUrl": "https://www.alaninu.com/products/energy-drink-cosmic-stardust",
    "imageUrl": "https://www.alaninu.com/cdn/shop/files/stretch_AN-Website-12oz-PDP-CSD-01-2_v1.png?v=1782921685&width=1000"
  },
  {
    "slug": "alani-nu-witchs-brew",
    "pageUrl": "https://www.alaninu.com/products/energy-drink-witchs-brew-2026?koala_external_link=1",
    "imageUrl": "https://www.alaninu.com/cdn/shop/files/Stretch_AN-Website-12oz-PDP-WBR-01_V2.png?v=1785982428&width=1000"
  },
  {
    "slug": "bang-star-blast",
    "pageUrl": "https://www.bangenergy.com/en-us/products/star-blast/",
    "imageUrl": "https://web-assests.monsterenergy.com/mnst/929024b2-6940-4e7a-9b13-dd69a1f0dc64.png"
  },
  {
    "slug": "bang-peach-mango",
    "pageUrl": "https://www.bangenergy.com/en-us/products/peach-mango/",
    "imageUrl": "https://web-assests.monsterenergy.com/mnst/60c2522e-693d-4448-818e-3346fe45a894.png"
  },
  {
    "slug": "bang-blue-razz",
    "pageUrl": "https://www.bangenergy.com/en-us/products/blue-razz/",
    "imageUrl": "https://web-assests.monsterenergy.com/mnst/c6278556-1aee-475b-b522-16ba49b89bca.png"
  },
  {
    "slug": "full-throttle-original",
    "pageUrl": "https://www.drinkfullthrottle.com/en-us/products/",
    "imageUrl": "https://web-assests.monsterenergy.com/mnst/dda5900f-e7d5-46e6-9c36-2685705286ff.png"
  },
  {
    "slug": "c4-energy-frozen-bombsicle",
    "pageUrl": "https://cellucor.com/products/c4-performance-energy-frozen-bombsicle",
    "imageUrl": "https://cellucor.com/cdn/shop/files/C4BEV_3114_Digital_FrozenBomb_Wave0_Performance_BasicPDPs-Hero-Grey-Sticker.png?v=1775067428&width=1000"
  },
  {
    "slug": "rockstar-original",
    "pageUrl": "https://www.rockstarenergy.com/products/the-original",
    "imageUrl": "https://www.rockstarenergy.com/cdn/shop/files/1720545676-original_d4e37562-d26e-4fc8-a3b9-e9df99785b21.png?v=1761060858&width=1000"
  },
  {
    "slug": "guru-organic-energy-original",
    "pageUrl": "https://guruenergy.com/en-us/collections/fees-products/products/guru-organic-energy-us",
    "imageUrl": "https://guruenergy.com/cdn/shop/files/OG-355-1_a82de2e5-37d1-4e92-8f53-b3651c55c962.png?v=1769037637&width=1000"
  },
  {
    "slug": "nos-original",
    "pageUrl": "https://www.kroger.com/p/nos-original-energy-drink-can/0081515402000",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0081515402000"
  },
  {
    "slug": "reign-melon-mania",
    "pageUrl": "https://www.homedepot.com/p/312154017",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0081515402164"
  },
  {
    "slug": "reign-razzle-berry",
    "pageUrl": "https://www.chefstore.com/p/reign-razzle-berry-energy-drink_9775714/",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0081515402166"
  },
  {
    "slug": "ghost-energy-cherry-limeade",
    "pageUrl": "https://www.meijer.com/shopping/product/-/81002829894",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0081002829894"
  },
  {
    "slug": "ghost-energy-sour-patch-kids-redberry",
    "pageUrl": "https://www.kroger.com/p/ghost-zero-sugar-sour-patch-kids-redberry-energy-drink-can/0081002829329",
    "imageUrl": "https://www.kroger.com/product/images/large/front/0081002829329"
  }
];
const date='2026-11-11';
function record(slug,title,svg,notes,{size=16,family='energy-standard-can',uncertainty=''}={}){
 const r=evidence.find(r=>r.slug===slug);if(!r)throw Error('Missing reference '+slug);
 return {slug,family,packageChoice:`Representative US ${size} fl oz / ${size===12?'355':'473'}mL ${title} aluminum can, exact inspected package.`,references:[{pageUrl:r.pageUrl,imageUrl:r.imageUrl,inspectedAt:date,visuallyInspected:true,observations:notes}],uncertainty:`Catalog has no package size. Exact photographed package selected; label art, wordmarks, tiny claims and fine illustrations simplified as original vectors. ${uncertainty} Final aesthetic approval and web-device review pending.`,status:'needs-review',svg};
}
const leaf=(x,y,s=1,c='#5a9e38',r=0)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0Q-25 1-22-19Q-4-22 0 0" fill="${c}"/><path d="M-19-17-1-1" stroke="#add076" stroke-width="1"/></g>`;
const wheel=(x,y,r,c,skin)=>`<g transform="translate(${x} ${y})"><circle r="${r}" fill="${skin}"/><circle r="${r-2}" fill="#f8f0c8"/><circle r="${r-3.5}" fill="${c}"/>${Array.from({length:8},(_,i)=>`<path d="M0 0 ${Math.cos(i*Math.PI/4)*(r-3.5)} ${Math.sin(i*Math.PI/4)*(r-3.5)}" stroke="#f5edcd" stroke-width=".9"/>`).join('')}</g>`;
const berries=(x,y,s=1,c='#a92964')=>`<g transform="translate(${x} ${y}) scale(${s})">${[[-7,-8],[1,-11],[8,-7],[-11,0],[-3,-2],[5,0],[12,1],[-7,7],[1,8],[7,8],[0,15]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="5.1" fill="${c}" stroke="#d6a1c0" stroke-width=".5"/><path d="M${x-2} ${y-2}q2-2 4 0" stroke="#eec9dc" stroke-width=".7" fill="none" opacity=".5"/>`).join('')}</g>`;
const sparkle=(x,y,r,c='#fff4dc')=>`<path d="M${x-r} ${y}q${r} 0 ${r}-${r}q0 ${r} ${r} ${r}q-${r} 0-${r} ${r}q0-${r}-${r}-${r}Z" fill="${c}"/>`;
const stars=(c,n=18)=>Array.from({length:n},(_,i)=>sparkle(66+i*23%72,47+i*31%171,i%3?1.2:2.5,c)).join('');
const celsiusDefs=(c,c2=c)=>`<linearGradient id="__ID__white"><stop stop-color="#b7c0bd"/><stop offset=".25" stop-color="#fafbf6"/><stop offset=".58" stop-color="#eef0eb"/><stop offset="1" stop-color="#b9c3bf"/></linearGradient><linearGradient id="__ID__C" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c}"/><stop offset=".33" stop-color="${c2}"/><stop offset=".37" stop-color="#c0c3bb"/><stop offset="1" stop-color="#777d76"/></linearGradient>`;
const cSpecs=[['celsius-arctic-vibe','ARCTIC VIBE','#0687c7','#193f95','arctic'],['celsius-sparkling-peach-vibe','PEACH VIBE','#e02a48','#cc2041','peach'],['celsius-kiwi-guava','KIWI GUAVA','#ed8199','#58a42a','kiwi'],['celsius-sparkling-wild-berry','WILD BERRY','#d62d58','#8c1f59','berry'],['celsius-sparkling-cola','COLA','#c88c29','#7e3c23','cola']];
function celsius(d){const[slug,title,c,c2,kind]=d;
 const texture=kind==='arctic'?Array.from({length:65},(_,i)=>`<path d="m${65+i*13%72} ${31+i*19%194} 5-15" stroke="#237cae" stroke-width=".4" opacity=".3"/>`).join(''):kind==='peach'?Array.from({length:100},(_,i)=>`<circle cx="${68+i*19%65}" cy="${34+i*23%190}" r=".55" fill="${i%2?'#008b72':c}" opacity=".4"/>`).join(''):'';
 let fruit='';
 if(kind==='kiwi')fruit=`<g transform="translate(91 144) rotate(-23)"><path d="M-9-21Q12-18 15 10Q1 28-13 9Z" fill="#dda450" stroke="#9bbd4f" stroke-width="1.5"/><path d="M-7-18Q9-15 12 9Q0 23-10 7Z" fill="#ef8c87"/>${[-8,0,8].map(y=>`<ellipse cx="1" cy="${y}" rx=".5" ry="1" fill="#f5c58a"/>`).join('')}</g><ellipse cx="110" cy="150" rx="15" ry="17" fill="#9f8d38"/><ellipse cx="110" cy="150" rx="13" ry="15" fill="#82b53c"/><ellipse cx="110" cy="150" rx="4" ry="7" fill="#d4e484"/>${Array.from({length:14},(_,i)=>{const a=i*Math.PI/7;return `<ellipse cx="${110+8*Math.cos(a)}" cy="${150+10*Math.sin(a)}" rx=".65" ry="1" fill="#343c21"/>`}).join('')}`;
 if(kind==='berry')fruit=`${berries(101,149,.9,'#cb3b51')}${[[83,151],[88,164],[115,165],[122,151]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="6.3" fill="#283752" stroke="#7c8b9e" stroke-width=".6"/><path d="m${x-2} ${y-2} 3 1-2 3" stroke="#596b8e" fill="none" stroke-width=".8"/>`).join('')}`;
 if(kind==='cola')fruit=Array.from({length:75},(_,i)=>`<circle cx="${73+i*19%54}" cy="${145+i*23%24}" r="${i%3?.55:.8}" fill="${['#bd5425','#df9326','#f5c44c'][i%3]}"/>`).join('');
 const vibe=kind==='arctic'||kind==='peach';
 const titleArt=kind==='arctic'?`${text(100,148,'ARCTIC',17,'#15568b','font-weight="900" font-style="italic" textLength="58" lengthAdjust="spacingAndGlyphs" transform="rotate(-8 100 148)" stroke="#1d2c58" stroke-width=".3"')}${text(99,167,'Vibe',21,'#7d3986','style="font-family:Georgia,serif;font-style:italic"')}<path d="M71 178 81 166 86 171 95 161 105 169 113 165 129 179Z" fill="#7d8078"/><path d="m81 166 4 6 2-1 8-10 5 7-5-2-4 7Z" fill="#fff9e6"/>`:kind==='peach'?`${text(100,149,'PEACH',20,'none','font-weight="bold" font-style="italic" stroke="#dc2947" stroke-width=".7" textLength="54" lengthAdjust="spacingAndGlyphs"')}${text(97,170,'VIBE',22,'none','font-weight="bold" font-style="italic" stroke="#dc2947" stroke-width=".7" textLength="48" lengthAdjust="spacingAndGlyphs"')}<path d="M130 133v41m0-40q-10-7-15-2 8-1 15 6m0-5q6-8 12-5-8 2-11 10m-1-5q-4-10 1-15 0 7 1 13" stroke="#309989" stroke-width="2" fill="none"/>`:fruit;
 const label=`${texture}${text(100,39,title,4.6,c,'font-weight="bold"')}<g transform="translate(101 78)"><path d="M15-20H-2C-32-20-34 20-4 22 2 23 9 21 14 17L7 10C3 13-7 13-10 7-19-7-3-11 4-11 11-11 15-15 15-20Z" fill="${ref('C')}"/><circle cx="-25" cy="-15" r="4.2" fill="none" stroke="#8a8e89" stroke-width="2.1"/></g>${text(100,119,'CELSIUS',13.7,'#202622','font-weight="bold" textLength="53" lengthAdjust="spacingAndGlyphs"')}${text(117,126,'LIVE FIT',4.4,c,'font-weight="bold"')}${titleArt}${!vibe?`${text(99,177,'SPARKLING',7.5,'#252b26')}${text(84,184,title,4.5,c,'font-weight="bold"')}`:''}<path d="M66 188q34 5 68 0v23q-34 5-68 0Z" fill="${vibe?ref('metal'):'#222725'}"/><path d="M66 188q6 1 8 1v23l-8-1Z" fill="${c}"/>${text(105,197,'ESSENTIAL ENERGY',3.8,vibe?'#202723':'#f4f4e9')}${text(105,203,'ACCELERATES METABOLISM',3.1,vibe?'#202723':'#f4f4e9')}${text(105,208,'BURNS BODY FAT',3.6,vibe?'#202723':'#f4f4e9')}${text(80,223,'0',9,'#1d2520','font-weight="bold"')}${text(80,227,'SUGAR',2,'#1d2520')}${text(111,225,'12 FL OZ',3.4,'#364238')}`;
 return record(slug,'CELSIUS '+title,can(slug,'CELSIUS '+title,label,{narrow:true,color:ref('white'),defs:celsiusDefs(c,c2)}),`Manufacturer exact ${title} front can inspected: white/silver slim can, gray lower C and ${c}/${c2} upper swoosh, degree symbol, black CELSIUS and flavor-colored LIVE FIT. ${kind==='arctic'?'Blue diagonal hatchwork, Arctic Vibe title and gray mountains':kind==='peach'?'Red/teal dotted textures, red outline PEACH VIBE and palm tree':kind==='kiwi'?'Separate guava wedge and green kiwi wheel':kind==='berry'?'Red raspberry with dark blueberries':'Small amber/brown effervescent cola dot field'}. ${vibe?'Metallic':'Black'} lower information strip and silver rims. Official image directory dates 2023; exact documented label retained without claiming latest revision.`,{size:12,family:'celsius-slim-can'});
}
const planet=(x,y,r,c,ring=true)=>`<g transform="translate(${x} ${y}) rotate(-25)"><circle r="${r}" fill="${c}"/><path d="M${-r*.6} ${-r*.5}q${r*.6}-${r*.6} ${r*1.2} 0" stroke="#f9d1ed" stroke-width="2" fill="none" opacity=".5"/>${ring?`<ellipse rx="${r*1.6}" ry="${r*.35}" fill="none" stroke="#d7b6f3" stroke-width="1.7"/>`:''}</g>`;
const aSpecs=[['breezeberry','#152c60','#13c7f3','#26d6ba'],['cosmic-stardust','#2c1548','#b28de3','#66d4bb'],['witchs-brew','#7141b6','#88e300','#fffce6']];
function alani(d){const[f,c,accent,logo]=d,witch=f==='witchs-brew',slug='alani-nu-'+f;
 const wave=`<path d="M65 41q60 11 67 78-29-27-39-22 34 33 39 97-49 27-65-29 37 41 59 31-16-40-43-65-17-21-18-90Z" fill="${f==='breezeberry'?'#8e9cce':'#bf7fbc'}" opacity=".33"/><path d="M66 44q64 5 65 75M68 163q20 56 61 38" stroke="${accent}" stroke-width="1.3" opacity=".5" fill="none"/>`;
 let art=wave;
 if(f==='breezeberry')art+=`${[[68,55,.55],[131,71,.55],[70,153,.65],[132,144,.5],[80,212,.6],[120,219,.7]].map(([x,y,s])=>berries(x,y,s,'#1165a3')).join('')}<path d="M67 191q6-20 10-1l2 9 4-13q5-7 5 2l-2 16 7-4q8 2-1 10l-17 7-7-8Z" fill="#17c5ec"/>`;
 if(f==='cosmic-stardust')art+=`${planet(71,53,10,'#db65a4',false)}${planet(130,63,12,'#ed9ec3')}${planet(71,103,7,'#f1e6fb')}${planet(76,211,14,'#9b73d0',false)}${planet(122,218,9,'#eca1ce')}<g transform="translate(130 139)"><path d="M-4 10q-5-15 0-30 6 11 5 30Z" fill="#ded4dc"/><ellipse cy="-8" rx="2" ry="3" fill="#947acb"/><path d="m-4 11 2 21 4-21" fill="#ee9bb1"/></g>${stars('#fff3df',16)}`;
 if(witch){
  art=`${Array.from({length:10},(_,i)=>`<path d="M${65+i%2*68} ${55+i*17}q${i%2?-20:20}-12 ${i%2?-12:12} 9t${i%2?13:-13} 10" fill="none" stroke="#1ad7cd" stroke-width="1" opacity=".55"/>`).join('')}${stars('#31dcd3',14)}<path d="M76 160q22-11 45 0l-3 32q-20 11-38-1Z" fill="#d5e6d7" stroke="#fff7ed" stroke-width="1"/><ellipse cx="98" cy="160" rx="23" ry="7" fill="#51df23"/><path d="M121 166q13-5 12 7t-14 11" fill="none" stroke="#d9e6df" stroke-width="4"/><path d="M80 157q4-24 17-9t18-12q14 18 5 29" fill="#53e42a" stroke="#20cfd2" stroke-width="1"/>${[[73,110],[127,117],[76,205],[129,202]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="6" fill="#b1ed21"/><path d="M${x-3} ${y-3}q4-7 6 0v5h-6Z" fill="#8841ba"/><circle cx="${x}" cy="${y}" r="1" fill="#fff2bf"/>`).join('')}`;
 }
 const letters=alaniScript.replaceAll('#5cdbbc',logo);
 const label=`<path d="M65 26h70v16H65Z" fill="${accent}"/>${art}${witch?`${text(100,49,"WITCH’S BREW",5.9,'#c5f333','font-weight="bold"')}`:f==='cosmic-stardust'?`${text(100,61,'COSMIC',6.5,'#cfb5ee','font-weight="bold" letter-spacing="1"')}${text(100,69,'STARDUST',6.2,'#cfb5ee','font-weight="bold" letter-spacing=".7"')}`:text(100,60,'BREEZEBERRY',6.4,accent,'font-weight="900" stroke="#13355b" stroke-width=".35" textLength="56" lengthAdjust="spacingAndGlyphs"')}${witch?alaniScript.replace('translate(105 174) rotate(-90) scale(.8 .65)','translate(70 94) scale(.65 .65)').replaceAll('#5cdbbc','#fffce9'):letters}${!witch?`<g transform="translate(118 126) rotate(-90)">${text(0,0,'NU',11,logo,'letter-spacing="3"')}</g>`:''}${text(100,witch?217:186,'ENERGY',witch?5:10,witch?'#fffce7':'#ffa3be','font-style="italic" textLength="43" lengthAdjust="spacingAndGlyphs"')}${!witch?`<path d="M65 222q35 4 70 0v11H65Z" fill="#42c7b3"/>`:''}${text(100,229,'12 FL OZ',3.5,'#f9f8e7')}`;
 return record(slug,'Alani Nu '+f,can(slug,'Alani Nu '+f,label,{narrow:true,color:c}),`Exact manufacturer front image independently inspected: ${witch?'2026 purple/bright-green Witch’s Brew, white horizontal Alani script, green/teal bubbling cauldron and small horror-eye/flower graphics':'dark '+(f==='breezeberry'?'navy body, cyan neck, mint vertical Alani script/NU, pink ENERGY, blue raspberry clusters and swooping blue/lilac fluid ribbons':'purple/black body, lavender neck, mint vertical Alani/NU, pink ENERGY, pastel planets, rocket, stars and purple ribbon artwork')}. ${witch?'Green':'Aqua'} lower accents; silver rims. Side/back panel photos checked only as supplemental evidence; drawing uses verified front.`,{size:12,family:'alani-slim-can',uncertainty:witch?'Documented seasonal 2026 artwork; do not substitute earlier Halloween cans.':''});
}
const bSpecs=[['star-blast','STAR BLAST','#058bc3','#e72d40'],['peach-mango','PEACH MANGO','#ee8d26','#afc437'],['blue-razz','BLUE RAZZ','#00b4cf','#00b7d1']];
function bang(d){const[f,title,c,inner]=d,slug='bang-'+f;
 const label=`<path d="M57 26h86v17H57Z" fill="${c}"/>${text(100,37,'FUEL YOUR DESTINY',5.3,'#fff9ed','font-weight="bold" font-style="italic" textLength="72" lengthAdjust="spacingAndGlyphs"')}<path d="M58 42h84v181H58Z" fill="#f2f6ee"/><path d="M66 49v160m-5-158v162m76-165v164" stroke="${c}" stroke-width=".7" opacity=".5"/><g transform="translate(100 96)"><path d="M-24-43h12v22q25-10 31 12t-11 38q-23 10-35-14V-43Z" fill="#fffdf5" stroke="#172c47" stroke-width="4"/><path d="M-24-43h12v22q25-10 31 12t-11 38q-23 10-35-14V-43Z" fill="none" stroke="${c}" stroke-width="1.6"/><circle r="17" fill="${inner}" stroke="#1c2b3a" stroke-width="2"/><path d="M-11-4h-21m47 0h16m-32-26v15m0 30v23" stroke="#1b344d" stroke-width="4"/><path d="M-11-4h-21m47 0h16m-32-26v15m0 30v23" stroke="${c}" stroke-width="1.5"/><path d="M-6-4q12 12 11-9-10 3-5 10-3 6-10 6 5 6 12 0-2 8-13 5" fill="#171d23"/></g>${text(100,166,'bang',27,inner,'font-weight="bold" letter-spacing="-1" stroke="#1b2938" stroke-width=".8" paint-order="stroke"')}${text(100,178,'ENERGY',8,c,'font-weight="bold" letter-spacing="1"')}${text(100,190,title.split(' ')[0],7.8,c,'font-weight="bold"')}${text(100,199,title.split(' ')[1],7.8,c,'font-weight="bold"')}<circle cx="132" cy="211" r="6" fill="none" stroke="${inner}" stroke-width="1.1"/>${text(132,214,'0',7,inner,'font-weight="bold"')}${text(95,223,'16 FL OZ (473 mL)',3.6,'#566064')}`;
 return record(slug,'Bang '+title,can(slug,'Bang '+title,label,{color:ref('metal')}),`Exact current manufacturer ${title} can individually inspected: white/silver 16oz body, ${c} neck border and FUEL YOUR DESTINY, large outlined lowercase b/target with ${inner} center, black head/brain motif, matching bang and ENERGY lettering; stacked ${title} flavor. Colored zero badge low at right. Colored studio backdrop excluded. Shared logo geometry follows each inspected front, with independently checked accent colors.`,{family:'bang-energy-can'});
}
const rSpecs=[['melon-mania','MELON MANIA','#df2332','#54bd32'],['razzle-berry','RAZZLE BERRY','#02adc9','#7130b5']];
function reign(d){const[f,title,a,b]=d,slug='reign-'+f;const logo=`<g transform="translate(100 112)"><path d="M-31-37-12-25 0-42 14-25 31-37 26-9 0-1-26-9Z" fill="${a}"/><path d="M0-42 14-25 31-37 26-9 0-1Z" fill="${b}"/><path d="M-26-5 0 4v51L-26 28Z" fill="${a}"/><path d="M0 4 26-5V28L0 55Z" fill="${b}"/><path d="m-16 7 10 4v11l-7-3v19l-7-7V16l7 3v-5l-3-1ZM9 11l12-4v8l-5 2v17l-7 8V24l-5 2v-8l5-2Z" fill="#111817"/></g>`;
 const label=`${text(100,44,'BCAA AMINOS',6.5,a,'style="font-family:Georgia,serif;font-weight:bold" letter-spacing=".6"')}${logo}${text(100,185,'REIGN',21,a,'font-weight="900" textLength="70" lengthAdjust="spacingAndGlyphs"')}${text(100,196,'TOTAL BODY FUEL',5.6,'#eeeee4','font-weight="bold" letter-spacing=".7"')}${text(100,217,title,5.1,a,'font-weight="bold"')}`;
 return record(slug,'REIGN '+title,can(slug,'REIGN '+title,label,{color:'#101615',tab:a}),`Exact earlier US 16oz ${title} can photo independently inspected: matte/textured black body, ${a}/${b} split crown/helmet emblem; ${a} BCAA AMINOS on shoulder, large REIGN, white TOTAL BODY FUEL, matching flavor low on can. Black rim and colored pull tab. Manufacturer current lineup omits this flavor; exact earlier retail package retained, not substituted with a current gummy flavor.`,{family:'reign-energy-can',uncertainty:'Historical US product documented additionally in the 2024-08-29 commissary planogram https://prod.commissaries.com/filebrowser/download/10528?fid=10528 ; current availability unverified.'});
}
function ghost(redberry=false){const slug=redberry?'ghost-energy-sour-patch-kids-redberry':'ghost-energy-cherry-limeade',title=redberry?'Sour Patch Kids Redberry':'Cherry Limeade',top=redberry?'#e92339':'#a3d845',base=redberry?'#f7e300':'#f42c3a',foot=redberry?'#ef2837':'#a6d948';
 const doodles=Array.from({length:24},(_,i)=>{const x=61+i*23%79,y=54+i*37%154;return `<path d="m${x} ${y} 4-2 3 4-2 4-4-1 1-3m-1 3-2 4" stroke="${redberry?'#e7b529':'#d51d32'}" stroke-width="1" fill="none"/>`;}).join('');
 const spk=redberry?`${text(105,192,'SOUR',7.5,'#1b2320','font-weight="900" transform="rotate(-7 105 192)"')}${text(105,201,'PATCH',7.5,'#1b2320','font-weight="900" transform="rotate(-7 105 201)"')}${text(116,207,'Kids',5.4,'#e8df23','font-weight="bold" stroke="#263122" stroke-width=".4" paint-order="stroke"')}<path d="M77 180q-5-8-10-3-3 4 1 9l-4 5 5 2 2 8 4-2 1-8 5-3Z" fill="#ed2b3b"/>`: `<circle cx="95" cy="204" r="5" fill="#b42533"/><circle cx="105" cy="206" r="5" fill="#c12737"/><path d="m96 200 6-9 3 11" fill="none" stroke="#3a7231" stroke-width="1.3"/>`;
 const label=`<path d="M57 26h86v22l-8-3-6 6-12-4-10 5-8-5-11 4-12-6-8 5-11-3Z" fill="${top}"/>${doodles}<path d="M57 211q43-9 86 0v25H57Z" fill="${foot}"/>${text(100,39,'ENERGY',7.9,'#fffde9','font-weight="bold" font-style="italic" stroke="#19231e" stroke-width="2.4" paint-order="stroke"')}${text(100,47,'ZERO SUGAR',3.4,'#fffde9','font-weight="bold" stroke="#19231e" stroke-width="1" paint-order="stroke"')}<g transform="translate(105 123) rotate(-90)">${text(0,0,'GHOST',34,'#fffef4','font-weight="900" font-style="italic" textLength="110" lengthAdjust="spacingAndGlyphs" stroke="#17271e" stroke-width="3.6" paint-order="stroke"')}</g><path d="M93 71V62q0-12 11-12t11 12v10l-5-3-4 4-5-4-8 2Z" fill="#fffdeb" stroke="#1a281f" stroke-width="1.8"/><ellipse cx="101" cy="61" rx="1.5" ry="2.1" fill="#18231c"/><ellipse cx="108" cy="61" rx="1.5" ry="2.1" fill="#18231c"/>${spk}${text(100,219,redberry?'REDBERRY':'CHERRY LIMEADE',redberry?5.8:5.2,'#fffdf0','font-weight="900" stroke="#18271e" stroke-width=".9" paint-order="stroke"')}${text(100,228,'16 FL OZ (473 mL)',3.1,'#263324')}`;
 return record(slug,'GHOST '+title,can(slug,'GHOST '+title,label,{color:base}),`Exact retailer US 16oz ${title} can inspected: ${redberry?'yellow main body, red shoulder/base, red candy-kid and black SOUR PATCH Kids mark':'red main body, lime-green shoulder/base and cherry motif'}, outlined white vertical GHOST with small ghost character above, black/white ENERGY ZERO SUGAR badge at shoulder, dense tone-on-tone line doodles, ${title} near foot. Retail image annotations excluded.`,{family:'ghost-energy-can',uncertainty:redberry?'Exact historical licensed SOUR PATCH Kids artwork retained. Dated supporting image source: https://consultgroup.co/wp-content/uploads/2024/02/2024-Consult-Group-Beverage-Catalogue-1.pdf ; not replaced with Sour Punch or Hydration.':'Manufacturer pages were JS-only for exact flavor artwork; retailer front image used.'});
}
function nos(){const slug='nos-original';const label=`<path d="M57 27h86v16H57Z" fill="#161b1a"/>${text(100,38,'HIGH PERFORMANCE',5.7,'#ee8b42','font-weight="900" textLength="74" lengthAdjust="spacingAndGlyphs"')}<path d="M61 45h8v175h-8Z" fill="#1b6589"/><g transform="translate(118 136) rotate(-90)">${text(0,0,'NOS',57,'#fff8df','font-weight="900" textLength="141" lengthAdjust="spacingAndGlyphs" stroke="#172c37" stroke-width="4.3" paint-order="stroke"')}<path d="M-73-44h10v-8l-13 10 13 10v-8h-10Z" fill="#fff8df" stroke="#172c37" stroke-width="2"/></g><g transform="translate(132 140) rotate(-90)">${text(0,0,'HIGH PERFORMANCE ENERGY DRINK',4.7,'#e88337','font-weight="bold" textLength="137" lengthAdjust="spacingAndGlyphs"')}</g>${text(100,223,'ENERGY DRINK · 16 FL OZ',3.9,'#102d40','font-weight="bold"')}`;return record(slug,'NOS Original',can(slug,'NOS Original',label,{color:'#1595c5'}),'Exact retailer Original 16oz front can inspected: cyan/blue body, black shoulder with orange HIGH PERFORMANCE, huge vertical white angular NOS outlined black, orange vertical HIGH PERFORMANCE ENERGY DRINK at right; silver lid/base. No bottle-shaped NOS tank substituted. Manufacturer product grid was JS-only; documented exact retail can used.',{family:'nos-energy-can'});}
const star=(x,y,r,c,stroke='none',sw=0)=>`<path d="${Array.from({length:10},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,rr=i%2?r*.4:r;return `${i?'L':'M'}${x+Math.cos(a)*rr} ${y+Math.sin(a)*rr}`}).join('')}Z" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
function rockstar(){const slug='rockstar-original',gold='#d8b439';const label=`<path d="M57 26h86v17H57Z" fill="${gold}"/>${text(100,38,'ORIGINAL',5.2,'#151b18','font-weight="900"')}${text(100,64,'ROCKSTAR',12,gold,'font-weight="900" textLength="77" lengthAdjust="spacingAndGlyphs"')}${text(100,72,'ENERGY DRINK',4.7,'#fff4cf','font-weight="bold" letter-spacing="1"')}${star(100,130,45,'none',gold,3.7)}${star(100,130,38,'#e6c049')}${text(100,140,'ЯR',16,'#20231c','font-weight="900"')}${text(100,195,'SUSTAINS',8,gold,'font-weight="bold"')}${text(100,203,'MIND-BODY ENERGY',4.5,gold,'font-weight="bold"')}<path d="M57 213h86v22H57Z" fill="${gold}"/>${text(100,227,'16 FL OZ (473mL)',3.7,'#24251b')}`;return record(slug,'Rockstar Original',can(slug,'Rockstar Original',label,{color:'#141917'}),'Exact manufacturer US16oz The Original packshot inspected: black can, gold neck with black ORIGINAL, wraparound gold ROCKSTAR ENERGY DRINK, large outlined gold five-point star with mirrored-R emblem, gold SUSTAINS MIND-BODY ENERGY and gold footer. Selected The Original rather than separate Original O.G. throwback or24oz. Tiny footer seals omitted.',{family:'rockstar-energy-can'});}
function guru(){const slug='guru-organic-energy-original';const label=`${Array.from({length:45},(_,i)=>`<circle cx="${61+i*17%77}" cy="${35+i*23%183}" r=".7" fill="#f9c6af" opacity=".24"/>`).join('')}<g transform="translate(106 141) rotate(-70)">${text(0,0,'GURU',22,'#fffef0','font-weight="900" textLength="103" lengthAdjust="spacingAndGlyphs" letter-spacing="-1"')}</g>${leaf(113,79,.48,'#fffef0',90)}${leaf(119,78,.48,'#fffef0',150)}${text(100,192,'GOOD ENERGY.',8.5,'#fffbe9','font-weight="900" font-style="italic" textLength="58" lengthAdjust="spacingAndGlyphs"')}${text(100,204,'ORIGINAL',9,'#fffbe9','font-weight="900"')}${text(100,215,'ORGANIC ENERGY DRINK',3.6,'#fffbe9','font-weight="bold"')}${text(100,225,'12 FL OZ (355mL)',3.4,'#fffbe9')}`;return record(slug,'GURU Organic Original',can(slug,'GURU Organic Original',label,{narrow:true,color:'#d31c37'}),'Exact manufacturer US355mL/12oz Original can inspected: slim red can with white diagonal bold GURU and leaf marks, white GOOD ENERGY and ORIGINAL, fine organic-energy copy at foot, silver rims. Image named OG-355; explicit US product page and12oz size option used. USDA seal omitted rather than invented.',{size:12,family:'guru-slim-can'});}
function c4(){const slug='c4-energy-frozen-bombsicle';const confetti=Array.from({length:85},(_,i)=>{const x=58+i*7%22,y=41+i*23%183,c=['#1eaccf','#d7224e','#bce4e6','#e9f4db'][i%4];return `<path d="m${x} ${y} 5 3-4 7-3-3Z" fill="${c}"/>`}).join('');const label=`<path d="M57 27h86v18H57Z" fill="#2a90ba"/>${text(100,37,'FROZEN BOMBSICLE',6.2,'#fff9e7','font-weight="900" font-style="italic" textLength="74" lengthAdjust="spacingAndGlyphs"')}${confetti}<g transform="translate(120 133) rotate(-90)">${text(0,0,'C4',63,'#141a17','font-weight="900" textLength="138" lengthAdjust="spacingAndGlyphs" stroke="#fff8d6" stroke-width=".8" paint-order="stroke"')}</g><g transform="translate(138 142) rotate(-90)">${text(0,0,'PERFORMANCE ENERGY',7,'#187faa','font-weight="900" font-style="italic" textLength="131" lengthAdjust="spacingAndGlyphs"')}</g>${text(105,213,'ZERO SUGAR',5.8,'#17271f','font-weight="900"')}${text(100,223,'16 FL OZ (473mL)',3.7,'#17271f')}`;return record(slug,'C4 Frozen Bombsicle',can(slug,'C4 Frozen Bombsicle',label,{color:'#f4e629'}),'Exact manufacturer current Performance Energy16oz Frozen Bombsicle can inspected: yellow main body, oversized vertical black C4, blue vertical PERFORMANCE ENERGY, blue flavor shoulder strip, red/blue/white fractured ice graphics down left, black ZERO SUGAR footer. Promotional NEW LOOK NEW FORMULA label outside can excluded. Manufacturer states redesigned package; documented selected revision, not old yellow/black formula.',{family:'c4-energy-can'});}
function fullThrottle(){const slug='full-throttle-original';const feather=(x,y,rot,s=1)=>`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0Q-5-11 0-35Q8-12 0 0" fill="#d9ddd6" stroke="#464f49" stroke-width=".5"/><path d="M0-2V-31m0 7 3 5m-3 0-2 5m2 1 2 5" stroke="#5d6660" stroke-width=".6" fill="none"/></g>`;
 const wings=Array.from({length:13},(_,i)=>`${feather(70+i*.7,91+i*7,-38-i*4,.9)}${feather(130-i*.7,91+i*7,38+i*4,.9)}`).join('');
 const tail=Array.from({length:9},(_,i)=>feather(84+i*4,182,155+i*6,1.2)).join('');
 const shield='M72 125Q100 111 128 125v43q-2 20-28 32-26-12-28-32Z';
 const label=`${text(100,43,'ORIGINAL',8.8,'#e2c45a','font-weight="900" font-style="italic"')}${text(100,51,'CITRUS',4.7,'#d6b748','font-weight="bold"')}${wings}${tail}<path d="M90 115Q73 101 86 85q9-17 28-10l7 5 6 1-5 6-9-3q-9 2-8 12l9 17Z" fill="#cdd4cd" stroke="#3a423e" stroke-width="1"/><path d="M106 79q18-7 19 10l-7-5-7 5-4-3Z" fill="#dcb243" stroke="#695a2a" stroke-width=".8"/><path d="m100 79 9 1-5 4-7-1Z" fill="#222b24"/><circle cx="104" cy="81" r="1.2" fill="#f7edb7"/><path d="${shield}" fill="#203f70" stroke="#a6aaa0" stroke-width="4"/><path d="M73 124q27-12 54 0v25H73Z" fill="#bb2e31"/>${[[88,155],[109,157],[97,176],[115,179],[84,179]].map(([x,y])=>star(x,y,5,'#edeedc')).join('')}${text(100,143,'Full',19,'#e0b43e','style="font-family:Georgia,serif;font-weight:bold" stroke="#1c2520" stroke-width="1.2" paint-order="stroke"')}${text(100,162,'Throttle',17,'#e0b43e','style="font-family:Georgia,serif;font-weight:bold" textLength="69" lengthAdjust="spacingAndGlyphs" stroke="#1c2520" stroke-width="1.3" paint-order="stroke"')}<path d="m66 113-4-8 4-3-5-9m70 2 5 6-4 7 5 5m-68 81-5 9 4 3-3 9m64-18 5 8-4 4 2 7" stroke="#d7be56" stroke-width=".8" fill="none"/>`;
 return record(slug,'Full Throttle Original Citrus',can(slug,'Full Throttle Original Citrus',label,{color:'#101514'}),'Exact manufacturer Original Citrus front can inspected: black16oz body, gold ORIGINAL/CITRUS shoulder, large white/gray bald eagle and spread feather wings, gold beak/talons, US red/white/blue shield with stars and gold outlined Full Throttle lettering, small lightning accents. Intricate feather/engraving detail simplified as original vector artwork; no promotional backdrop included.',{family:'full-throttle-energy-can'});
}
export const records=[...cSpecs.map(celsius),...aSpecs.map(alani),...bSpecs.map(bang),...rSpecs.map(reign),ghost(false),ghost(true),nos(),rockstar(),guru(),c4(),fullThrottle()];
