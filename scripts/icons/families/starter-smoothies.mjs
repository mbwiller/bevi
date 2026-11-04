import {wrap,shadow,ref,text} from '../style.mjs';

// Four café servings, one smoothie bottle, and three explicitly identified RTDs.
const date='2026-11-04';
const record=(slug,family,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty='')=>({slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations}],uncertainty:`${uncertainty} Fine lettering, texture and package illustrations simplified as original vectors. Final aesthetic approval and native-device review pending.`.trim(),status:'needs-review',svg});

function jamba(slug,title,{color,light,dark,fleck,texture=40,peaks='mango'}) {
  const body='M49 78Q100 89 151 78L135 217Q134 231 100 233T65 217Z';
  const top=peaks==='mango'?'M53 77q13-6 23-1 3-11 21-10 14 5 22-2 7-5 12 4 2 9 17 8Q100 92 53 77Z':peaks==='cream'?'M53 77q12-3 20-7 6-2 11 2 10 7 19 0 11-13 19-1 3 9 26 6Q100 91 53 77Z':peaks==='coral'?'M53 77q13-2 24-8 8-3 15 1 11 4 15-6 9-11 16 5 7 8 25 8Q100 92 53 77Z':'M53 77q13-6 23-2 8-9 17-3 13-9 20-3 7 7 16 2 9-2 19 6Q100 91 53 77Z';
  return wrap(slug,title,`${shadow(56)}
<path d="M113 82 129 24q1-3 5-2t3 5l-17 59Z" fill="${ref('straw')}"/><path d="M130 25 115 81" stroke="#ffd77a" stroke-width="1.4"/><ellipse cx="133" cy="24" rx="3.5" ry="1.5" transform="rotate(14 133 24)" fill="#ffbb52"/>
<path d="${body}" fill="${ref('smoothie')}" stroke="${dark}" stroke-width=".6"/>
<g clip-path="${ref('cupclip')}">
${Array.from({length:texture},(_,i)=>`<ellipse cx="${55+i*19%90}" cy="${86+i*31%137}" rx="${i%4?.35:.65}" ry="${i%4?.5:.8}" fill="${fleck}" opacity="${i%3?'.2':'.35'}"/>`).join('')}
<path d="M53 94q47 10 94 0M55 106q45 10 90 0M62 194q38 7 76 0M64 213q36 7 72 0" fill="none" stroke="${light}" stroke-width="1.3" opacity=".45"/>
<g fill="none" stroke="#fffce8" stroke-opacity=".86" stroke-width="4.2" stroke-linecap="round">
<path d="M75 120C87 144 127 145 129 128C130 111 99 111 87 122"/>
<path d="M84 146C86 168 117 169 118 156C119 146 101 146 94 153"/>
<path d="M93 173C98 185 111 185 111 178C111 172 103 173 101 176M101 193q8 8 15 0"/>
</g>
<path d="M59 93 72 212" stroke="#fff" stroke-opacity=".19" stroke-width="3" fill="none"/>
<path d="M140 95 129 212" stroke="#fff" stroke-opacity=".12" stroke-width="1.4" fill="none"/>
<path d="${body}" fill="${ref('shade')}" opacity=".45"/>
</g>
<ellipse cx="100" cy="78" rx="51" ry="9" fill="${light}" stroke="#e9e8ce" stroke-width="1.2"/>
<path d="${top}" fill="${ref('smoothietop')}"/>
<path d="M57 77q15-2 23-1m13 1q9-5 17-3m9 2 13 2" fill="none" stroke="${light}" stroke-width="1.8" stroke-linecap="round"/>
<ellipse cx="100" cy="78" rx="51" ry="9" fill="none" stroke="#fffdf2" stroke-opacity=".63" stroke-width="1.4"/>
<path d="M66 219q34 14 68 0" fill="none" stroke="${light}" stroke-opacity=".65" stroke-width="1.6"/>
`, `<clipPath id="__ID__cupclip"><path d="${body}"/></clipPath><linearGradient id="__ID__smoothie"><stop stop-color="${dark}"/><stop offset=".22" stop-color="${light}"/><stop offset=".58" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="__ID__smoothietop" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${light}"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="__ID__straw"><stop stop-color="#ffcd4c"/><stop offset=".3" stop-color="#ffad14"/><stop offset="1" stop-color="#ed790b"/></linearGradient>`);
}

const strawberry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-10-4Q-13-16 0-12 13-16 11-3L0 15Q-9 9-10-4Z" fill="#df3352"/><path d="m-2-12-5-6 8 4 5-5-1 7 7-2-8 7Z" fill="#398b3b"/>${[[-5,-5],[3,-5],[-2,1],[5,3],[0,8]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx=".6" ry="1.2" fill="#f6d475"/>`).join('')}</g>`;
const banana=(x,y,s=1)=>`<g transform="translate(${x} ${y}) rotate(-15) scale(${s})"><path d="M-16 5Q3 11 14-12L12-18Q14 7 3 15-8 21-16 5Z" fill="#f4d956" stroke="#e0b938" stroke-width=".7"/><path d="M-12 8Q5 14 13-12" fill="none" stroke="#fff1a6" stroke-width="1.4"/></g>`;
function bolthouse() {
  const slug='bolthouse-farms-strawberry-banana',shape='M84 39h32v15q1 13 12 27 14 16 14 35l-3 105q0 13-39 13t-39-13l-3-105q0-19 14-35 11-14 12-27Z';
  const label=`<path d="M58 87q42-7 84 0v140H58Z" fill="#de668e"/>
${banana(112,74,.95)}${strawberry(77,80,.85)}${strawberry(129,80,.72)}${strawberry(140,122,.7)}
${text(100,118,'Bolthouse',17.5,'#fff7e8','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="72" lengthAdjust="spacingAndGlyphs"')}${text(100,132,'Farms',15,'#fff7e8','style="font-family:Georgia,serif;font-weight:bold;font-style:italic"')}
<path d="M59 145 141 140v39l-82 8Z" fill="#c52658"/>
${text(100,157,'STRAWBERRY',8.8,'#f6d6b4','font-weight="bold" textLength="68" lengthAdjust="spacingAndGlyphs" transform="rotate(-4 100 157)"')}${text(100,168,'BANANA',10,'#f6d6b4','font-weight="bold" transform="rotate(-4 100 168)"')}
<path d="M65 183 135 178v11l-70 5Z" fill="#fff8e7"/>${text(100,187,'100% JUICE SMOOTHIE',4.6,'#c23757','font-weight="bold" transform="rotate(-4 100 187)"')}
${text(100,224,'15.2 FL OZ',4.1,'#f8dfd0')}`;
  return wrap(slug,'Bolthouse Farms Strawberry Banana',`${shadow(53)}<path d="${shape}" fill="${ref('pink')}" stroke="#a96765" stroke-width=".7"/>
<g clip-path="${ref('bottleclip')}">${label}<path d="${shape}" fill="${ref('shade')}" opacity=".65"/><path d="M67 94v121" stroke="#fff" stroke-opacity=".21" stroke-width="2.5"/></g>
<path d="M84 43h32M84 48h32" stroke="#c7d4bc" stroke-width="1.1" opacity=".7"/>
<path d="M79 24q21-5 42 0v15q-21 4-42 0Z" fill="#d72e5d"/><ellipse cx="100" cy="24" rx="21" ry="3.8" fill="#f65c80"/>${Array.from({length:16},(_,i)=>`<path d="M${81+i*2.6} 27v10" stroke="#ff7c99" stroke-width=".7"/>`).join('')}
<path d="M63 226q37 9 74 0" stroke="#f5c2b5" stroke-opacity=".6" fill="none" stroke-width="1.6"/>
`, `<clipPath id="__ID__bottleclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__pink"><stop stop-color="#ad6d6c"/><stop offset=".23" stop-color="#e5a19c"/><stop offset=".55" stop-color="#c37d79"/><stop offset="1" stop-color="#9c6764"/></linearGradient>`);
}

function highbrew(slug,flavor,{blue=false}={}) {
  const shape='M72 43Q100 36 128 43L133 58V220Q133 233 100 233T67 220V58Z';
  const label=`<path d="M66 42h68v49H66Z" fill="${blue?'#238dce':'#d18d27'}"/>
${text(100,60,blue?'AUSTIN':'90',blue?5.8:11,blue?'#17365c':'#172d42','font-weight="bold" letter-spacing="1"')}
${text(100,69,blue?'TEXAS':'CALORIES',4.5,blue?'#153456':'#fff7e7','font-weight="bold" letter-spacing=".7"')}
<ellipse cx="100" cy="117" rx="31" ry="45" fill="#10264d" stroke="#fff9e8" stroke-width="1.5"/>
${text(100,94,'COLD-BREW',5.7,'#fff9ec','font-weight="bold" letter-spacing="1.2"')}
${text(100.7,118,'HIGH',22.5,'#b73d43','font-weight="bold" textLength="57" lengthAdjust="spacingAndGlyphs"')}${text(100,117,'HIGH',22.5,'#fff9eb','font-weight="bold" textLength="57" lengthAdjust="spacingAndGlyphs"')}
${text(101,142,'Brew',24,'#ba3b46','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="56" lengthAdjust="spacingAndGlyphs"')}${text(100,141,'Brew',24,'#fff9eb','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" textLength="56" lengthAdjust="spacingAndGlyphs"')}
${text(100,153,'COFFEE',7.1,'#fff8e9','font-weight="bold" letter-spacing="1.6"')}
${text(100,181,blue?'Mexican':'Salted',13,blue?'#153151':'#fff6e8','style="font-family:Georgia,serif;font-style:italic;font-weight:bold"')}
${text(100,195,blue?'VANILLA':'CARAMEL',12,blue?'#122f50':'#fff6e8','font-weight="bold" letter-spacing=".4" textLength="57" lengthAdjust="spacingAndGlyphs"')}
${text(100,203,'NATURAL FLAVOR',3.7,blue?'#fff6e8':'#f0dabf','letter-spacing=".6"')}
${text(100,224,'8 FL OZ (237 mL)',4.5,blue?'#163856':'#fff6e8')}`;
  return wrap(slug,`High Brew ${flavor}`,`${shadow(46)}<path d="${shape}" fill="${ref('can')}"/><g clip-path="${ref('bodyclip')}">${label}<path d="${shape}" fill="${ref('shade')}"/><path d="M74 62v151" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2.5"/></g>
<ellipse cx="100" cy="43" rx="28" ry="7" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1"/><ellipse cx="100" cy="43" rx="24" ry="4.5" fill="none" stroke="#8d9892" stroke-width=".7"/><ellipse cx="103" cy="44" rx="6" ry="2.5" fill="#657169"/><path d="M95 41h8q4 0 3 3t-6 2h-4q-4-1-1-5" fill="none" stroke="#e6e8de" stroke-width="2"/>
<path d="M70 226q30 12 60 0" fill="none" stroke="${ref('metal')}" stroke-width="3.7"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__can"><stop stop-color="${blue?'#1470b0':'#704b34'}"/><stop offset=".24" stop-color="${blue?'#48a8e0':'#9d6a48'}"/><stop offset=".55" stop-color="${blue?'#208fcd':'#87583d'}"/><stop offset="1" stop-color="${blue?'#116ca9':'#61412d'}"/></linearGradient>`);
}

function stok() {
  const slug='stok-cold-brew-black',shape='M80 43h40l1 19q0 17 14 33 14 14 14 34l-2 89q0 16-47 16t-47-16l-2-89q0-20 14-34 14-16 14-33Z';
  const label=`<path d="M53 116 66 103h68l13 13v98H53Z" fill="${ref('teal')}"/>
${text(100,112,'BOLD & SMOOTH',6.5,'#fff8e8','font-weight="bold" letter-spacing=".7"')}
${text(100,157,'STŌK',42,'#112d29','font-weight="bold" textLength="83" lengthAdjust="spacingAndGlyphs"')}
${text(100,173,'COLD',13,'#102b26','font-weight="bold" letter-spacing="2.1"')}${text(100,186,'BREW',13,'#102b26','font-weight="bold" letter-spacing="2"')}${text(100,202,'COFFEE',18,'#102b26','font-weight="bold" textLength="80" lengthAdjust="spacingAndGlyphs"')}
<path d="M55 210h28m-3-3 5 3-5 3M145 210h-28m3-3-5 3 5 3" fill="none" stroke="#15392f" stroke-width="1"/>
<path d="M100 211q-14 15 0 18 14-3 0-18Z" fill="#102f28"/><path d="M100 216v10m-4-8 8 6m0-6-8 6" stroke="#eaf2df" stroke-width="1"/>
<path d="M93 45h14v53l-7-2-7 2Z" fill="#0b7962"/>
<g transform="translate(98 72) rotate(90)">${text(0,0,'UN-SWEET',5.1,'#fff8e7','font-weight="bold" textLength="34" lengthAdjust="spacingAndGlyphs"')}</g>${text(100,92,'BLACK',3.8,'#fff8e7','font-weight="bold"')}`;
  return wrap(slug,'SToK Cold Brew Black',`${shadow(59)}<path d="${shape}" fill="${ref('black')}" stroke="#242624" stroke-width=".8"/>
<g clip-path="${ref('bottleclip')}">${label}<path d="${shape}" fill="${ref('shade')}" opacity=".6"/><path d="M63 126v85" fill="none" stroke="#fff" stroke-opacity=".13" stroke-width="3"/><path d="M139 130v79" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.5"/></g>
<path d="M75 24q25-8 50 0l-3 22q-22 7-44 0Z" fill="#141a18"/><ellipse cx="100" cy="24" rx="25" ry="6" fill="#282f2a"/>
${Array.from({length:7},(_,i)=>`<path d="M${78+i*7.1} 27l${i<3?2:-2} 15" stroke="${i%2?'#343c35':'#070d0a'}" stroke-width="4.5"/>`).join('')}
<path d="M58 226q42 8 84 0" fill="none" stroke="#5f5144" stroke-opacity=".5" stroke-width="1.6"/>
`, `<clipPath id="__ID__bottleclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__black"><stop stop-color="#302728"/><stop offset=".25" stop-color="#514343"/><stop offset=".58" stop-color="#392e30"/><stop offset="1" stop-color="#241f21"/></linearGradient><linearGradient id="__ID__teal"><stop stop-color="#137667"/><stop offset=".3" stop-color="#279c85"/><stop offset=".6" stop-color="#168d76"/><stop offset="1" stop-color="#0f705e"/></linearGradient>`);
}

const jambaData=[
 ['jamba-juice-mango-a-go-go','Mango-a-go-go','mango-a-go-go','https://ctfassets.gotofoods.com/zqt8tllj2cy0/2wpTdxyro3vLc2jc7GndlF/b4a7ed95da704b2676807244ed0b4bcc/JAM-mango-a-go-go-thumbnail-544x544.png',{color:'#f7c54d',light:'#ffdf7a',dark:'#d8a12c',fleck:'#cf982c',texture:35,peaks:'mango'},'Golden-yellow blended smoothie, clear tapered cup and exposed rolled rim; pale thick scoop at top, orange straw tilting right, white descending swirl Jamba emblem. No lid, fruit garnish or visible ice cubes.'],
 ['jamba-juice-strawberry-surf-rider','Strawberry Surf Rider','strawberry-surf-rider','https://ctfassets.gotofoods.com/zqt8tllj2cy0/3ejBaXXHrFzCy2O3IX7qbZ/36375cb766dd70e4ca62569d7ba77717/JAM-strawberry-surf-rider-thumbnail-544x544.png',{color:'#ef997e',light:'#ffc2a5',dark:'#d57667',fleck:'#be5f56',texture:65,peaks:'surf'},'Pale peach/coral smoothie with fine red fruit flecks, undulating exposed top and orange straw in a clear tapered cup with white descending swirl emblem. Individually checked lighter than Caribbean Passion; no lid or garnish.'],
 ['jamba-juice-caribbean-passion','Caribbean Passion','caribbean-passion','https://ctfassets.gotofoods.com/zqt8tllj2cy0/6Ajsy506KWvmcvBHTjThtU/3db41a612787b20ec1a810cf9f51c60a/JAM-caribbean-passion-thumbnail-544x544.png',{color:'#ed8a65',light:'#ffb491',dark:'#d46e4b',fleck:'#af5c42',texture:60,peaks:'coral'},'Deeper warm coral/orange-pink smoothie with red flecks and raised scoop ridge at center, orange straw, clear tapered cup and white descending swirl logo. Individually inspected, distinct from paler Strawberry Surf Rider. No fruit garnish or lid.'],
 ['jamba-juice-orange-dream-machine','Orange Dream Machine','orange-dream-machine','https://ctfassets.gotofoods.com/zqt8tllj2cy0/1XRG0yzFav1yDsCIugLTGw/e34b978a82575b4d1607456abae11b82/JAM-orange-dream-machine-thumbnail-544x544.png',{color:'#f0c96d',light:'#ffe3a0',dark:'#cba44e',fleck:'#d5b46a',texture:18,peaks:'cream'},'Creamy pale yellow-orange smoothie with a smoother folded top, few visible flecks, orange straw and clear tapered cup with white descending swirl emblem. Manufacturer serving has no whipped cream, orange slice, lid or ice cubes.'],
];
export const records=[
 ...jambaData.map(([slug,title,path,imageUrl,palette,observations])=>record(slug,'jamba-served-smoothie',`US café ${title} in the actual clear Jamba serving cup shown by manufacturer; representative standard serving, volume not inferred from photo.`,`https://www.jamba.com/menu/smoothies/${path}`,imageUrl,`Exact manufacturer product thumbnail independently visually inspected: ${observations}`,jamba(slug,title,palette),'Serving size and venue-specific container variations are not specified by catalog.')),
 record('bolthouse-farms-strawberry-banana','bolthouse-smoothie-bottle','US 15.2 fl oz Strawberry Banana juice smoothie bottle with pink cap/current pink sleeve.','https://www.bolthouse.com/product/strawberry-banana/','https://www.bolthouse.com/wp-content/uploads/sites/4/2016/01/071464270407_bhf_us_bev_15_pi_blnd_sb_front_520x720.png-260x360.png','Manufacturer bottle image inspected: clear tall PET bottle with curved shoulders, ribbed pink cap; pink/tan smoothie, pink full-body sleeve, strawberries and banana at shoulders, white Bolthouse Farms script, darker pink diagonal STRAWBERRY BANANA banner, white 100% JUICE SMOOTHIE band. Current page calls it a juice smoothie.',bolthouse()),
 record('high-brew-mexican-vanilla','high-brew-coffee-can','US 8 fl oz / 237mL Mexican Vanilla cold-brew coffee can, documented current blue package.','https://www.highbrewcoffee.com/products/mexican-vanilla','https://www.highbrewcoffee.com/cdn/shop/files/Copy_of_1._Amazon_Core_MexicanVanilla_12Pack_1024x1024.png?v=1762051749','Manufacturer exact single can in pack image inspected: slim short blue8oz can, silver lid/base, AUSTIN TEXAS near shoulder, large navy oval with white border and COLD-BREW/HIGH Brew/COFFEE; white brand lettering with red offset, dark Mexican VANILLA below, natural flavor and volume. Not Nitro or Vanilla Bean Triple Shot.',highbrew('high-brew-mexican-vanilla','Mexican Vanilla',{blue:true})),
 record('high-brew-salted-caramel','high-brew-coffee-can','US 8 fl oz / 237mL Salted Caramel cold brew coffee, documented orange/brown retailer package; not Nitro Caramel.','https://www.hy-vee.com/aisles-online/p/780223/high-brew-coffee-8-oz','https://fa74d61d848a20b729bb-0251b36b713060ab3e0e8321940e01ff.ssl.cf2.rackcdn.com/6bf8abb2-0af0-407e-911b-f9034535b74e_large.png','Retailer exact Salted Caramel can independently inspected: 8oz narrow aluminum can, silver top/base, orange top field marked90calories, deep brown lower field, navy oval COLD-BREW HIGH Brew COFFEE in white/red; white script Salted above CARAMEL and natural flavor. Manufacturer FAQ lists Salted Caramel separately from current Nitro.',highbrew('high-brew-salted-caramel','Salted Caramel'),'Manufacturer current Salted Caramel product page unavailable; manufacturer FAQ https://www.highbrewcoffee.com/pages/faq confirms product identity. Retailer package revision/availability unverified.'),
 record('stok-cold-brew-black','stok-cold-brew-bottle','US 48 fl oz SToK UN-SWEET Black/Bold & Smooth bottle, explicitly selected plain unsweetened variant; not Espresso/Extra Bold or sweetened.','https://www.stokbrew.com/cold-brew/cold-brew-coffee/unsweetened-cold-brew-coffee-48oz/','https://www.stokbrew.com/wp-content/uploads/Stok-UnSw-BlkBoldSmooth-48oz.webp','Manufacturer exact bottle image inspected: wide dark-brown/black PET bottle with tall black faceted screw cap, neck strip UN-SWEET/BLACK, teal front label and BOLD & SMOOTH header, oversized black STŌK COLD BREW COFFEE, arrow dividers and black droplet/snowflake at foot. Background radiating rays are promotional and excluded.',stok(),'Catalog says Black without roast detail; selected manufacturer flagship plain unsweetened Bold & Smooth package and recorded the choice.'),
];
