import {wrap,shadow,ref,text} from '../style.mjs';

// Individually inspected variants. Original family assets/primitives stay frozen.
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
const bullPath='M0 6c-4-3-9-3-13 0l-6 1-4 6-6 2-2 7 4-1 4-5 6-2 2 5 3 1 1-6 5 1 2 4 4 1-2-7 5 4 3-1-5-6-2-4 3-4-1-3-4 4Z';
const opposingBulls=`<circle cx="100" cy="139" r="12" fill="#e9bc57"/><g fill="#cc1740" stroke="#f4d37b" stroke-width=".6"><path d="${bullPath}" transform="translate(98 129) scale(.65)"/><path d="${bullPath}" transform="translate(102 129) scale(-.65 .65)"/></g>`;
const sugarfree=can('red-bull-sugarfree','Red Bull Sugarfree',`
<path d="M59 25H127L104 131H59ZM104 131h37v107H79Z" fill="${ref('iceblue')}"/>
${text(100,116,'Red Bull',17,'#cc1240','font-weight="bold" letter-spacing="-.7"')}
${opposingBulls}${text(100,165,'SUGARFREE',7.7,'#bf1742','letter-spacing="2"')}
<path d="M59 204h82v12H59Z" fill="#d0d7dd"/>
${text(100,213,'Vitalizes body and mind.',4.2,'#3687ae')}
${text(100,225,'250 ml · 8.4 FL OZ',4.5,'#e6e9ed')}`,
{slim:true,color:ref('metal'),defs:'<linearGradient id="__ID__iceblue"><stop stop-color="#1687be"/><stop offset=".25" stop-color="#45b5dc"/><stop offset=".6" stop-color="#209acb"/><stop offset="1" stop-color="#1178aa"/></linearGradient>'});

function edition(slug,editionName,flavor,color,ink,light,dark) {
  const head=`<path d="M77 23H141V51q-5 3-10-3l-9-6q-8-2-8-10 0 11 9 17l-5 10-11 5-2 7 5 3-3 9-12 5-1 13-6 8 1-17-12 9-3 14-6 3-4-3 4-5 2-15-5-4-2-10-3 4-4-4 7-10 10-2 4-7-9-4-2-8 5 6 8 2 5-8 3-12Z" fill="${ref('metal')}"/>
<path d="M83 68q9 1 16-6l-4 14-5 6" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  const label=`${head}
${text(77,119,'THE',7,ink,'font-weight="bold"')}
${text(100,141,editionName,editionName==='YELLOW'?18.8:26,'none',`font-weight="bold" stroke="${ink}" stroke-width=".65" textLength="70" lengthAdjust="spacingAndGlyphs"`)}
${text(88,155,'EDITION',9.4,ink,'letter-spacing=".7"')}
<g transform="translate(72 194) rotate(-90)">${text(0,0,'Red Bull',16,'#dfe5e3','font-weight="bold" letter-spacing="-.4" textLength="70" lengthAdjust="spacingAndGlyphs"')}</g>
${text(112,183,flavor,flavor==='Watermelon'?8.3:11.5,ink,'style="font-family:Georgia,serif;font-style:italic"')}
<path d="M92 188h49" stroke="${ink}" stroke-width=".7"/><circle cx="92" cy="188" r="2" fill="${ink}"/>
${text(107,207,'ENERGY DRINK',6.4,editionName==='RED'?'#fff8e8':ink)}
${text(108,224,'250 ml · 8.4 FL OZ',4.1,editionName==='RED'?'#fff8e8':ink)}`;
  return can(slug,`Red Bull ${flavor}`,label,{slim:true,color:ref('edition'),defs:`<linearGradient id="__ID__edition"><stop stop-color="${dark}"/><stop offset=".24" stop-color="${light}"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`});
}

const clawPaths=[
'M69 72 74 69 78 70 82 67 86 69 90 68 94 71 89 77 88 83 90 88 87 94 89 100 86 106 87 113 84 120 85 128 82 137 81 144 79 151 78 140 77 135 79 130 77 123 79 117 77 111 79 106 77 99 79 92 77 86 78 79 74 75 67 75Z',
'M88 72 94 68 99 67 103 64 108 67 113 67 117 72 113 76 111 82 113 89 110 95 113 102 110 110 111 117 108 124 107 133 104 143 101 153 99 159 99 145 97 138 99 132 97 124 99 117 97 110 99 103 96 97 98 90 96 83 98 77 94 74Z',
'M111 74 116 70 122 69 127 67 130 70 132 76 130 81 131 87 128 94 130 100 128 108 128 115 125 122 124 131 122 140 120 149 118 137 119 130 117 123 119 115 117 109 119 102 117 96 119 90 117 83 118 78 112 77Z'];
const claw=(fill,outline='#171b1a')=>`<g fill="${fill}" stroke="#fff8e8" stroke-width="3.7" stroke-linejoin="round">${clawPaths.map(d=>`<path d="${d}"/>`).join('')}</g><g fill="${fill}" stroke="${outline}" stroke-width="2" stroke-linejoin="round">${clawPaths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
function filigree(stroke,opacity=.5) {
  return `<g fill="none" stroke="${stroke}" stroke-width=".6" opacity="${opacity}">${Array.from({length:12},(_,i)=>{
    const x=i%2?137:61,y=47+Math.floor(i/2)*29,s=i%2?-1:1;
    return `<g transform="translate(${x} ${y}) scale(${s} 1)"><path d="M0 0q20-10 22 4t-13 6q-5-8 4-8 8 2 2 6M2 4q-10 12 0 23 8 7 12 1 2-5-3-7-6-1-4 5M8 12q15 0 16 12-12 1-16-12Z"/><path d="M9 13 22 23m-7-5 3-1"/></g>`;
  }).join('')}</g>`;
}
const flower=(x,y,color,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})">${Array.from({length:6},(_,i)=>`<ellipse cx="0" cy="-5" rx="3" ry="5.7" transform="rotate(${i*60})" fill="${color}" stroke="#302e2c" stroke-width=".6"/>`).join('')}<circle r="2.7" fill="#edc535" stroke="#242e27" stroke-width=".6"/></g>`;
const skull=(x,y,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-10 0Q-12-14 0-15 12-14 10 0l-4 4v7H-6V4Z" fill="#f4e7c1" stroke="#102b30" stroke-width="1.2"/><ellipse cx="-4.5" cy="-3" rx="3.4" ry="4" fill="#164943"/><ellipse cx="4.5" cy="-3" rx="3.4" ry="4" fill="#164943"/><path d="m0 0-2 4h4Z" fill="#164943"/><path d="M-5 7H5M-3 5v5M0 5v5M3 5v5" stroke="#164943" stroke-width=".7"/><path d="M-7-10-4-8M7-10 4-8" stroke="#ee6335" stroke-width="1.3"/><circle cy="-11" r="2" fill="#ec7631"/></g>`;
function butterflies() {
  return `<g fill="#183d38" opacity=".8">${[[65,53,-20],[133,72,25],[65,122,-25],[135,160,40]].map(([x,y,r])=>`<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0Q-12-9-8-15-1-17 0-3 1-16 8-14 12-7 1 1 8 4 5 10-2 10 0 1-2 9-9 7-7 1Z"/><path d="M0-3V9" fill="none" stroke="#e5e4a5" stroke-width=".5"/></g>`).join('')}</g>`;
}
function monster(slug,title,variant) {
  let fill,base,art,tab,top,nameInk,clawInk,extra='';
  if(variant==='ultra') {
    fill='#f4f6ef';base='#b9c5c2';tab='#303a36';top='ZERO SUGAR';nameInk='#151d1c';clawInk=ref('ultrasilver');
    art=filigree('#9ba9a5',.67);
    extra=`${text(100,199,'ENERGY',7.7,'#75b7cd','font-weight="bold" letter-spacing="3.5"')}${text(100,215,'ZERO ULTRA',8.8,'#151d1c','font-weight="bold" letter-spacing=".7"')}`;
  } else if(variant==='mango') {
    fill='#05b4dd';base='#008dbb';tab='#15b7d4';top='MANGO LOCO';nameInk='#fffbe3';clawInk=ref('mangoclaw');
    art=`${filigree('#15332a',.8)}${skull(62,106,.7)}${skull(138,141,.8)}${skull(61,177,.55)}${flower(137,65,'#e76c25',.75)}${flower(61,77,'#ed7130',.8)}${flower(132,211,'#ed5739',.8)}${flower(73,218,'#ef5c27',1)}<path d="M58 224q20-17 34 3 11-18 25-4 11-19 25-3v13H58Z" fill="#3e9d48" stroke="#164537" stroke-width=".7"/>`;
  } else if(variant==='pipeline') {
    fill='#f67d9f';base='#df537c';tab='#ec367b';top='PIPELINE PUNCH';nameInk='#fffbe9';clawInk='#f7b8c9';art=filigree('#ffcad6',.65);
  } else {
    fill='#f3c52f';base='#e6a323';tab='#e6a82c';top='KHAOTIC';nameInk='#fffbe8';clawInk='#70c3bd';
    art=`<g fill="none" stroke-linecap="round"><path d="M54 38q24 24 3 51t13 43-5 58q-7 18 0 38M141 40q-15 30-5 53t-9 47 16 31" stroke="#73d3bd" stroke-width="4"/><path d="M62 35q8 48 1 77t5 53-3 71M142 40q-11 35-1 58t-3 51-9 43" stroke="#ef6c9d" stroke-width="2"/><path d="M54 169q44-18 91-12M123 130l-8 50 24 23-8 31" stroke="#ff7597" stroke-width="1.7"/></g>${butterflies()}<path d="M56 62h22v26H56ZM124 199h20v27h-20Z" fill="#e8781d" opacity=".25"/>`;
  }
  const juice=variant!=='ultra';
  const label=`${art}
${text(100,43,top,top.length>13?7.2:8.5,'#152321','font-weight="bold" font-style="italic" textLength="76" lengthAdjust="spacingAndGlyphs"')}
${variant==='khaotic'?text(100,51,'TROPICAL ORANGE',4.9,'#183d31','font-weight="bold"'):''}
<g stroke="#fff8e8" stroke-width="3.7" paint-order="stroke">${claw(clawInk)}</g>
${juice?text(100,179,'JUICE',23,variant==='mango'?'#f4ae34':variant==='pipeline'?'#fbdce4':'#377d67','style="font-family:Georgia,serif;font-weight:bold" stroke="#151d19" stroke-width="1.3" paint-order="stroke" textLength="75" lengthAdjust="spacingAndGlyphs"'):''}
${text(100,juice?199:184,'MONSTER',18,nameInk,'style="font-family:Georgia,serif;font-weight:bold" letter-spacing="-.5" stroke="#1b2924" stroke-width=".65" paint-order="stroke" textLength="78" lengthAdjust="spacingAndGlyphs"')}
${juice?text(100,211,'ENERGY + JUICE',5.7,'#142c28','font-weight="bold" letter-spacing="1.3"'):extra}
${text(100,224,'16 FL OZ',3.9,variant==='ultra'?'#67746b':'#164b3d','letter-spacing=".8"')}`;
  return can(slug,title,label,{color:ref('body'),tab,
    defs:`<linearGradient id="__ID__body"><stop stop-color="${base}"/><stop offset=".23" stop-color="${fill}"/><stop offset=".65" stop-color="${fill}"/><stop offset="1" stop-color="${base}"/></linearGradient><linearGradient id="__ID__ultrasilver"><stop stop-color="#7a8984"/><stop offset=".3" stop-color="#f0f4ec"/><stop offset=".65" stop-color="#d4dcd5"/><stop offset="1" stop-color="#81928b"/></linearGradient><linearGradient id="__ID__mangoclaw"><stop stop-color="#f7c63b"/><stop offset=".5" stop-color="#fa982e"/><stop offset="1" stop-color="#e97425"/></linearGradient>`});
}

function celsiusWatermelon() {
  const label=`${text(100,39,'WATERMELON',4,'#b34b56','font-weight="bold" letter-spacing=".5"')}
<g transform="translate(101 78)"><path d="M15-20H-2C-32-20-34 20-4 22 2 23 9 21 14 17L7 10C3 13-7 13-10 7-19-7-3-11 4-11 11-11 15-15 15-20Z" fill="${ref('celsiusC')}"/><circle cx="-25" cy="-15" r="4.2" fill="none" stroke="#8a8e89" stroke-width="2.1"/></g>
${text(100,119,'CELSIUS',13.7,'#242925','font-weight="bold" textLength="53" lengthAdjust="spacingAndGlyphs"')}${text(116,126,'LIVE FIT',4.5,'#bc4658','font-weight="bold"')}
<g transform="translate(100 150) rotate(14)"><path d="M-22 0Q-4 36 22 0L0-23Z" fill="#50a668"/><path d="M-20-1Q-3 30 20-1L0-22Z" fill="#d4dfab"/><path d="M-17-3Q0 23 17-3L0-21Z" fill="#e65668"/>${[[-7,-1],[7,-3],[0,-9],[-3,6],[7,6],[-3,-15]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx="1" ry="1.7" fill="#252e24" transform="rotate(18 ${x} ${y})"/>`).join('')}</g>
${text(100,178,'SPARKLING',7.2,'#343b36')}${text(88,184,'WATERMELON',4.3,'#b64a5a','font-weight="bold"')}
<path d="M66 190q34 6 68 0v24q-34 6-68 0Z" fill="#292c2a"/><path d="M66 190q7 2 11 2v24l-11-2Z" fill="#c74555"/>
${text(104,198,'ESSENTIAL ENERGY',4,'#f4f3e9')}${text(104,204,'ACCELERATES METABOLISM',3.3,'#f4f3e9')}${text(104,209,'BURNS BODY FAT',3.6,'#f4f3e9')}
${text(80,225,'0',8,'#252d29','font-weight="bold"')}${text(113,225,'12 FL OZ',3.7,'#39423c')}`;
  const svg=can('celsius-sparkling-watermelon','Celsius Sparkling Watermelon',label,{narrow:true,color:ref('white'),
    defs:'<linearGradient id="__ID__white"><stop stop-color="#bac3bf"/><stop offset=".22" stop-color="#f7f8f2"/><stop offset=".55" stop-color="#f1f3ed"/><stop offset="1" stop-color="#c3cbc7"/></linearGradient><linearGradient id="__ID__celsiusC" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b52d43"/><stop offset=".34" stop-color="#d65b6b"/><stop offset=".4" stop-color="#d6d7cf"/><stop offset="1" stop-color="#737a74"/></linearGradient>'});
  return svg;
}

const reference=(pageUrl,imageUrl,observations)=>({pageUrl,imageUrl,inspectedAt:'2026-11-02',visuallyInspected:true,observations});
const record=(slug,packageChoice,refData,svg,uncertainty='')=>({slug,family:'energy-variant-can',packageChoice,references:[refData],uncertainty:`${uncertainty} Package lettering, claw/bull marks, decorative illustrations, condensation and tiny print simplified as original vectors. Final aesthetic approval and native-device review pending.`.trim(),status:'needs-review',svg});
export const records=[
  record('red-bull-sugarfree','US 8.4 fl oz / 250mL Sugarfree can; light-blue/silver quadrants, distinct from Original blue and Red Bull Zero.',reference('https://www.redbull.com/us-en/energydrink/products/red-bull-sugarfree','https://a.storyblok.com/f/287059/870x2200/e54b40774e/us_sf_250ml_sugarfree_country_rgb__cold_closed_front_com_25.png','Manufacturer US front can inspected: slim silver can with light cyan-blue diagonal quadrants; red Red Bull lettering and opposing red bulls on gold disk, widely spaced red SUGARFREE, pale metallic stripe near foot and silver rims.'),sugarfree),
  record('red-bull-tropical','US 8.4 fl oz / 250mL Yellow Edition Tropical; current US yellow/silver package.',reference('https://www.redbull.com/us-en/energydrink/products/red-bull-yellow-edition','https://a.storyblok.com/f/287059/870x2200/50f9e68454/us_yl_250ml_the-yellow-edition_country_rgb__cold_closed_front_com_25.png','Separate manufacturer US Yellow Edition front inspected: golden-yellow can with oversized silver bull-head artwork in upper half, THE YELLOW EDITION in gray outlined uppercase, silver vertical Red Bull at left lower body, italic Tropical on lower-right underline, gray ENERGY DRINK and silver rims. US page confirms tropical fruits, not UK Citrus Zest.'),edition('red-bull-tropical','YELLOW','Tropical','#f2c51a','#6e7772','#fbd739','#cba014')),
  record('red-bull-watermelon','US 8.4 fl oz / 250mL Red Edition Watermelon; regular sugar-containing edition, not Sugarfree.',reference('https://www.redbull.com/us-en/energydrink/products/red-bull-red-edition','https://a.storyblok.com/f/287059/870x2200/7d77a8f904/us_wm_250ml_ac_the-red-edition_country_rgb__cold_closed_front_com_25.png','Separate manufacturer US Red Edition image inspected: red can with oversized silver bull head high on face, green THE/outlined RED/EDITION, silver vertical Red Bull on left lower body, green italic Watermelon/underline, white ENERGY DRINK low on face, silver rims. Formula/page identify watermelon.'),edition('red-bull-watermelon','RED','Watermelon','#e73326','#09894b','#f44836','#c92420')),
  record('monster-energy-zero-ultra','US 16 fl oz / 473mL Monster Zero Ultra white can.',reference('https://www.monsterenergy.com/en-us/energy-drinks/zero-sugar/zero-ultra/','https://web-assests.monsterenergy.com/mnst/5587a01b-3c83-42f7-a741-b29a1d534409.png','Manufacturer white 16oz can inspected: silver/white filigree illustration around body, silver claw outlined black, black ZERO SUGAR on shoulder, angular white/black MONSTER near lower third, pale-blue spaced ENERGY and black ZERO ULTRA, silver lid/base and black pull tab.'),monster('monster-energy-zero-ultra','Monster Energy Zero Ultra','ultra')),
  record('monster-energy-mango-loco','US 16 fl oz / 473mL Juice Monster Mango Loco can, blue/orange illustrated package.',reference('https://www.monsterenergy.com/en-us/energy-drinks/juice-monster/mango-loco/','https://web-assests.monsterenergy.com/mnst/bcbf7fc0-05e9-4d0d-933c-30eabf9ca620.png','Separate manufacturer 16oz can inspected: bright turquoise body, orange/yellow claw with black/white outline; black MANGO LOCO shoulder, side Day of the Dead sugar skulls, floral/leaf scrollwork in orange/red/green, orange JUICE above white MONSTER low on label, black ENERGY + JUICE and blue pull tab.'),monster('monster-energy-mango-loco','Monster Energy Mango Loco','mango')),
  record('monster-energy-pipeline-punch','US 16 fl oz / 473mL Juice Monster Pipeline Punch, pink ornamental can.',reference('https://www.monsterenergy.com/en-us/energy-drinks/juice-monster/pipeline-punch/','https://web-assests.monsterenergy.com/mnst/6aa8ff45-fcd8-4c9d-b2b2-d15a69a1d465.png','Separate manufacturer 16oz can inspected: pink field with pale ornamental tropical scrollwork, pale-pink claw enclosed by black/white outline, black PIPELINE PUNCH shoulder, pale-pink JUICE above white/black MONSTER, black ENERGY + JUICE and pink pull tab; silver rims.'),monster('monster-energy-pipeline-punch','Monster Energy Pipeline Punch','pipeline')),
  record('monster-energy-juice-khaotic','US 16 fl oz / 473mL Juice Monster Khaotic Tropical Orange, documented retailer orange/yellow graffiti package.',reference('https://www.kroger.com/p/monster-khaotic-energy-drink-can/0007084703694','https://www.kroger.com/product/images/large/front/0007084703694','Separate retailer Khaotic 16oz can inspected: orange/yellow field with cyan and pink graffiti-like strokes and small butterfly silhouettes; teal claw outlined black/white, black KHAOTIC/TROPICAL ORANGE at shoulder, teal JUICE above white MONSTER, ENERGY + JUICE at base and gold pull tab. Khaotic name distinguishes it from predecessor Khaos.'),monster('monster-energy-juice-khaotic','Monster Energy Juice Khaotic','khaotic'),'Manufacturer US Khaotic product URL returned404; this represents the inspected retailer packaging. Current availability/packaging revision not established.'),
  record('celsius-sparkling-watermelon','US 12 fl oz / 355mL Celsius Sparkling Watermelon, white/silver can with red/gray C and watermelon wedge.',reference('https://www.kroger.com/p/celsiusa-sparkling-watermelon-energy-drink-can/0088939200362','https://www.kroger.com/product/images/large/front/0088939200362','Separate retailer Watermelon can inspected: slim white/silver can and dark upper rim, red WATERMELON at shoulder; red/gray C and degree symbol above black CELSIUS/red LIVE FIT; red fruit wedge with green rind/black seeds and bubbles; SPARKLING WATERMELON, black lower information band/red left accent, silver foot. Watermelon flavor, not Watermelon Lemonade.'),celsiusWatermelon(),'Manufacturer Celsius product/image requests were403 in this workflow; retailer package selected, revision date unverified.'),
];
