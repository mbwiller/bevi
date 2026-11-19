import {wrap,shadow,ref,text} from '../style.mjs';

// Two High Brew cans and one smoothie bottle (hidden below). The Jamba café servings moved to redraw-r6-served.mjs.
const date='2026-11-04';
const record=(slug,family,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty='')=>({slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations}],uncertainty:`${uncertainty} Fine lettering, texture and package illustrations simplified as original vectors. Final aesthetic approval and native-device review pending.`.trim(),status:'needs-review',svg});


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

export const records=[
 record('bolthouse-farms-strawberry-banana','bolthouse-smoothie-bottle','US 15.2 fl oz Strawberry Banana juice smoothie bottle with pink cap/current pink sleeve.','https://www.bolthouse.com/product/strawberry-banana/','https://www.bolthouse.com/wp-content/uploads/sites/4/2016/01/071464270407_bhf_us_bev_15_pi_blnd_sb_front_520x720.png-260x360.png','Manufacturer bottle image inspected: clear tall PET bottle with curved shoulders, ribbed pink cap; pink/tan smoothie, pink full-body sleeve, strawberries and banana at shoulders, white Bolthouse Farms script, darker pink diagonal STRAWBERRY BANANA banner, white 100% JUICE SMOOTHIE band. Current page calls it a juice smoothie.',bolthouse()),
 record('high-brew-mexican-vanilla','high-brew-coffee-can','US 8 fl oz / 237mL Mexican Vanilla cold-brew coffee can, documented current blue package.','https://www.highbrewcoffee.com/products/mexican-vanilla','https://www.highbrewcoffee.com/cdn/shop/files/Copy_of_1._Amazon_Core_MexicanVanilla_12Pack_1024x1024.png?v=1762051749','Manufacturer exact single can in pack image inspected: slim short blue8oz can, silver lid/base, AUSTIN TEXAS near shoulder, large navy oval with white border and COLD-BREW/HIGH Brew/COFFEE; white brand lettering with red offset, dark Mexican VANILLA below, natural flavor and volume. Not Nitro or Vanilla Bean Triple Shot.',highbrew('high-brew-mexican-vanilla','Mexican Vanilla',{blue:true})),
 record('high-brew-salted-caramel','high-brew-coffee-can','US 8 fl oz / 237mL Salted Caramel cold brew coffee, documented orange/brown retailer package; not Nitro Caramel.','https://www.hy-vee.com/aisles-online/p/780223/high-brew-coffee-8-oz','https://fa74d61d848a20b729bb-0251b36b713060ab3e0e8321940e01ff.ssl.cf2.rackcdn.com/6bf8abb2-0af0-407e-911b-f9034535b74e_large.png','Retailer exact Salted Caramel can independently inspected: 8oz narrow aluminum can, silver top/base, orange top field marked90calories, deep brown lower field, navy oval COLD-BREW HIGH Brew COFFEE in white/red; white script Salted above CARAMEL and natural flavor. Manufacturer FAQ lists Salted Caramel separately from current Nitro.',highbrew('high-brew-salted-caramel','Salted Caramel'),'Manufacturer current Salted Caramel product page unavailable; manufacturer FAQ https://www.highbrewcoffee.com/pages/faq confirms product identity. Retailer package revision/availability unverified.'),
];

// Keep the recovered production masters for these already shipped products.
records.splice(0, records.length, ...records.filter(r => !["bolthouse-farms-strawberry-banana"].includes(r.slug)));
