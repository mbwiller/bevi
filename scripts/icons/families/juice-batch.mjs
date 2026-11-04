import {wrap,shadow,ref,text} from '../style.mjs';

// Individually inspected manufacturer references, plus retailer Concord Grape.
const date='2026-11-02';
const leaf=(x,y,s=1,rot=0)=>`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0C-18-1-21-14-24-21-9-22 4-15 0 0Z" fill="${ref('leaf')}"/><path d="M0 0-22-19m9 10-7-1m12 5-7-1" fill="none" stroke="#a4bb59" stroke-width=".7"/></g>`;
const cap=(color,light,width=37)=>`<path d="M${100-width/2} 25q ${width/2} -4 ${width} 0v15q ${-width/2} 4 ${-width} 0Z" fill="${color}"/><ellipse cx="100" cy="25" rx="${width/2}" ry="3.6" fill="${light}"/>${Array.from({length:15},(_,i)=>`<path d="M${102-width/2+i*(width-4)/14} 28v10" stroke="${light}" stroke-opacity=".45" stroke-width=".8"/>`).join('')}<path d="M${100-width/2} 40q ${width/2} 4 ${width} 0" stroke="#173f32" stroke-opacity=".5" fill="none"/>`;
const fruit=(kind)=>{
  if(kind==='Apple')return `<path d="M100 168c-17-10-26 6-21 23 4 15 11 20 21 16 12 4 20-7 22-21 2-18-10-25-22-18Z" fill="${ref('fruit')}"/><path d="M100 172q-2-10 2-16" stroke="#75522b" stroke-width="2" fill="none"/>${leaf(99,177,.6,70)}<path d="M87 179q-4 7-2 15" stroke="#ffd4ab" stroke-opacity=".55" stroke-width="2.4" fill="none"/>`;
  const lime=kind==='Limeade',lemon=kind==='Lemonade',grapefruit=kind==='Grapefruit';
  return `<ellipse cx="100" cy="188" rx="${lemon||lime?21:22}" ry="${lemon||lime?23:22}" transform="rotate(22 100 188)" fill="${ref('fruit')}"/>
${Array.from({length:24},(_,i)=>`<ellipse cx="${83+i*17%35}" cy="${174+i*13%30}" rx=".55" ry=".7" fill="#fff3bc" opacity=".35"/>`).join('')}
${leaf(108,178,.65,75)}
${grapefruit?`<path d="M96 190h27q-1 26-26 20Z" fill="#f6dea3"/><path d="M99 193h20q-1 18-18 16Z" fill="#e76869"/><path d="m101 195 14 9m-14-9 7 12m-7-12 16 4" stroke="#f8c6a4" stroke-width=".7"/>`:''}`;
};
const simplyShape='M81 40h38q-3 18-2 27 1 17 24 35v118q0 12-11 13H70q-11-1-11-13V102q23-18 24-35 1-9-2-27Z';
function simply(d) {
 const apple=d.kind==='Apple';
 const panel='M68 112Q100 100 132 112L124 221H76Z';
 const decoration=apple?`${[-1,1].map(side=>`<g transform="translate(${100+side*23} 124)" fill="#d83e31"><path d="M-4-1h8v2h-8ZM-1-4h2v8h-2ZM-3-3h2v2h-2ZM1 1h2v2H1Z"/></g>`).join('')}<path d="m81 215 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4" fill="none" stroke="#d04d37" stroke-width=".9"/>`:'';
 const header=apple?'WINTER EDITION LOOK':d.kind==='Orange'?'PULP FREE':'ALL NATURAL';
 const titleSize=d.kind==='Grapefruit'?11.4:d.kind==='Lemonade'||d.kind==='Limeade'?14:17;
 return wrap(d.slug,`Simply ${d.kind}`,`${shadow(54)}
<path d="${simplyShape}" fill="${ref('juice')}" stroke="${d.edge}" stroke-width=".8"/>
<path d="M62 113v106q0 10 10 10h56q10 0 10-10V113" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1.4"/>
${[65,69,73,127,131,135].map(x=>`<path d="M${x} 113v102" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="1.1"/>`).join('')}
<path d="M85 48q3 21-5 39L65 106v109" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="3"/>
<path d="M115 46q-2 26 5 43l16 17v107" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.7"/>
<path d="${panel}" fill="${apple?'#fff0c7':'#fffdf3'}" stroke="#f1eedb" stroke-width=".7"/>
<path d="M71 113q29-10 58 0l-.4 7q-28-8-57 0Z" fill="${apple?'#fff0c7':d.band}"/>
${text(100,115,header,apple?3.3:4.5,apple?'#076144':'#fffdf1','font-weight="bold" letter-spacing=".35"')}
${decoration}
${text(100,139,'Simply',19,'#20251f','style="font-family:Georgia,serif;font-style:italic" letter-spacing="-1.5" textLength="57" lengthAdjust="spacingAndGlyphs"')}
${text(100,155,d.kind,titleSize,'#20251f','style="font-family:Georgia,serif;font-style:italic" letter-spacing="-1" textLength="56" lengthAdjust="spacingAndGlyphs"')}
${fruit(d.kind)}
${text(100,apple?209:215,apple?'SERVE HOT OR COLD':'NOT FROM CONCENTRATE',3.1,apple?'#086244':'#353a2d','font-weight="bold"')}
<path d="${simplyShape}" fill="${ref('shade')}" opacity=".35"/>
${cap('#006747','#158066',39)}
<path d="M93 25h14v35q-7 3-14 0Z" fill="#006746"/>
${d.kind==='Orange'?`${text(100,34,'RICH IN',2.6,'#fffdf0','font-weight="bold"')}${text(100,38,'VITAMIN C',2.7,'#fffdf0','font-weight="bold"')}`:`${text(100,37,'ALL',3,'#fffdf0','font-weight="bold"')}${text(100,41,'NATURAL',2.8,'#fffdf0','font-weight="bold"')}`}
<path d="M95 45h10" stroke="#b9d5b1" stroke-width=".5"/>
${d.kind==='Orange'?`${text(100,50,'NO ADDED',2.5,'#fffdf0','font-weight="bold"')}${text(100,55,'SUGAR',3,'#fffdf0','font-weight="bold"')}`:`${text(100,51,'DELICIOUS',2.5,'#fffdf0','font-weight="bold"')}${text(100,55,'TASTE',3,'#fffdf0','font-weight="bold"')}`}
<path d="M65 226q35 8 70 0" fill="none" stroke="#f8f4d5" stroke-opacity=".5" stroke-width="1.2"/>`,
`<linearGradient id="__ID__juice"><stop stop-color="${d.dark}"/><stop offset=".23" stop-color="${d.light}"/><stop offset=".55" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></linearGradient><radialGradient id="__ID__fruit" cx=".3" cy=".25" r=".8"><stop stop-color="${d.fruitLight}"/><stop offset=".65" stop-color="${d.fruit}"/><stop offset="1" stop-color="${d.fruitDark}"/></radialGradient><linearGradient id="__ID__leaf"><stop stop-color="#19502b"/><stop offset=".5" stop-color="#60953d"/><stop offset="1" stop-color="#284b26"/></linearGradient>`);
}
const simplyBase='https://www.coca-cola.com/content/dam/onexp/us/en/brands/simply/';
const simplyData=[
 {slug:'simply-orange',kind:'Orange',size:'46 fl oz',page:'orange-juices',image:simplyBase+'orange-/packshots/simply-orange-pulp-free.png',color:'#ffc74b',light:'#ffda6c',dark:'#e7a22e',edge:'#d7a23c',band:'#eb9822',fruit:'#ef8d15',fruitLight:'#ffd66c',fruitDark:'#be570d',observations:'Manufacturer Pulp Free image individually inspected: clear carafe with concave neck and wide flat-sided lower body, dark green ribbed cap/seal, bright opaque orange juice, white tapered label with orange PULP FREE header, black Simply Orange lettering and whole orange/green leaf. Manufacturer page lists 46oz as new size; no added-calcium or blend substituted.'},
 {slug:'simply-lemonade',kind:'Lemonade',size:'52 fl oz',page:'simply-lemonade',image:simplyBase+'lp-single-simply-lemonades/en_simply_prod_lemonade_750x750_v1.jpg',color:'#e7e4b8',light:'#f2edcc',dark:'#cfcc9d',edge:'#c6c597',band:'#edcc22',fruit:'#e6c62a',fruitLight:'#fff384',fruitDark:'#bb9c1d',observations:'Manufacturer Lemonade packshot independently inspected: clear shaped carafe, dark-green cap and neck seal, cloudy pale lemonade, tapered white label, yellow ALL NATURAL banner, black Simply Lemonade script and whole yellow lemon with green leaf. Original Lemonade, not Light or fruit-flavored variant.'},
 {slug:'simply-limeade',kind:'Limeade',size:'52 fl oz',page:'simply-lemonade',image:simplyBase+'simply-juices/en_simply_prod_limeade_750x750_v1.jpg',color:'#e3e4bd',light:'#f1eed0',dark:'#c6c99c',edge:'#c2c69c',band:'#76bc35',fruit:'#6eaa31',fruitLight:'#c1d96b',fruitDark:'#3b731e',observations:'Manufacturer Limeade packshot independently inspected: pale cloudy liquid in characteristic clear concave-neck carafe, dark-green cap/seal, white tapering label with green ALL NATURAL band, black Simply Limeade script and large green whole lime/leaf. Distinct lime artwork checked rather than inferring from Lemonade.'},
 {slug:'simply-apple',kind:'Apple',size:'52 fl oz',page:'juices-drinks',image:simplyBase+'holiday-2026/plp/simply-prod-apple-winteredition.jpg',color:'#be813a',light:'#d9a360',dark:'#8c572c',edge:'#9b6a3e',band:'#fff0c7',fruit:'#cc3531',fruitLight:'#ef8d52',fruitDark:'#8b1722',observations:'Current manufacturer Apple Winter Edition Look image independently inspected: amber cloudy apple juice, same clear carafe and green cap/seal; cream label with black Simply Apple script, red apple/green leaf, red pixel holiday motifs, WINTER EDITION LOOK and SERVE HOT OR COLD. Seasonal label explicitly selected; beverage remains original Apple.'},
 {slug:'simply-grapefruit',kind:'Grapefruit',size:'52 fl oz',page:'juices-drinks',image:simplyBase+'simply-juices/en_simply_prod_grapefruit_750x750_v1.jpg',color:'#f8a07a',light:'#ffc19a',dark:'#db7d5a',edge:'#d79170',band:'#dfa17f',fruit:'#e5b956',fruitLight:'#f7dda1',fruitDark:'#b97e31',observations:'Manufacturer Grapefruit packshot independently inspected: cloudy salmon-pink juice in clear carafe with dark-green cap/seal, white tapering label, peach ALL NATURAL header, black Simply Grapefruit script, yellow whole grapefruit with green leaf and a cut pink grapefruit wedge. 100% grapefruit, not a juice cocktail.'},
];

const welchShape='M83 40h34q0 4 5 8t0 18q0 8 14 24 16 16 15 36v82q-2 25-15 27H64q-13-2-15-27v-82q-1-20 15-36 14-16 14-24-5-14 0-18t5-8Z';
function grapes(white=false){
 const coords=[[-11,-9],[1,-13],[13,-9],[-17,2],[-4,1],[10,2],[20,5],[-10,13],[3,14],[12,15],[-2,24]];
 return `<g transform="translate(115 169)">${leaf(-3,-9,.9,80)}${coords.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="${i%3===0?8:7.1}" fill="${ref('grape')}" stroke="${white?'#9caf53':'#5c4b91'}" stroke-width=".35"/><ellipse cx="${x-2}" cy="${y-2.5}" rx="2.3" ry="1.4" fill="#fff" opacity=".22"/>`).join('')}</g>`;
}
function welch(slug,white){
 return wrap(slug,white?"Welch's 100% White Grape Juice":"Welch's 100% Concord Grape Juice",`${shadow(57)}
<path d="${welchShape}" fill="${ref('juice')}" stroke="${white?'#bca459':'#29222c'}" stroke-width=".8"/>
<path d="M86 47q-1 13 7 21 9 8 23 13 17 7 24 23" fill="none" stroke="${white?'#fff6bf':'#a9a6a2'}" stroke-opacity=".2" stroke-width="3"/>
<path d="M80 49q-9 14-3 25-14 13-20 26v15M67 98q1-13 16-20" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2.2"/>
<path d="M51 115q49 4 98 0v80q-49 6-98 0Z" fill="${white?'#4b8a3f':'#6b3697'}"/>
<path d="M51 115q49 4 98 0v80q-49 6-98 0Z" fill="${ref('label')}"/>
${grapes(white)}
<path d="M60 126q17 6 35-2t43-3l-4 27q-16-3-36 3t-35 0Z" fill="#fffdf1"/>
<path d="M61 122q18 7 38 1t38-4M65 152q20 7 40 0t29-2" fill="none" stroke="#fffdf1" stroke-width="1.8"/>
${text(99,144,"Welch's",22,'#28234c','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" letter-spacing="-1.6" transform="rotate(-6 99 138)" textLength="73" lengthAdjust="spacingAndGlyphs"')}
${text(80,169,'100%',15,'#fffdf0','style="font-family:Georgia,serif;font-weight:bold" letter-spacing="-.9"')}
${text(80,177,'GRAPE JUICE',4.3,'#fffdf0','font-weight="bold" letter-spacing=".1"')}
<path d="M52 180h96v14q-48 5-96 0Z" fill="${white?'#236039':'#492268'}"/>
${text(99,188,white?'WHITE GRAPE':'CONCORD GRAPE',6.5,'#fffdf0','font-weight="bold" letter-spacing=".4"')}
<path d="M56 202q-1 17 8 24M145 202q1 17-8 24" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.7"/>
<path d="M58 226q42 10 84 0" stroke="${white?'#f5dc83':'#8a3040'}" stroke-opacity=".6" stroke-width="1.8" fill="none"/>
<path d="${welchShape}" fill="${ref('shade')}" opacity=".4"/>
${cap('#70349a','#9563b6',35)}
<path d="M84 42h32" fill="none" stroke="${white?'#ccb365':'#29272b'}" stroke-width="2"/>`,
`<linearGradient id="__ID__juice"><stop stop-color="${white?'#d5b568':'#211b24'}"/><stop offset=".25" stop-color="${white?'#f8db8d':'#444144'}"/><stop offset=".5" stop-color="${white?'#edc978':'#17151a'}"/><stop offset=".85" stop-color="${white?'#dab564':'#080b10'}"/><stop offset="1" stop-color="${white?'#caa756':'#341824'}"/></linearGradient><linearGradient id="__ID__label"><stop stop-color="${white?'#2e6d31':'#522e7c'}"/><stop offset=".3" stop-color="${white?'#73aa48':'#8a63ad'}"/><stop offset="1" stop-color="${white?'#346d34':'#512b7a'}"/></linearGradient><radialGradient id="__ID__grape" cx=".3" cy=".25" r=".85"><stop stop-color="${white?'#eff8ad':'#b4bad4'}"/><stop offset=".55" stop-color="${white?'#b9d56a':'#727da8'}"/><stop offset="1" stop-color="${white?'#6f9d3d':'#40486b'}"/></radialGradient><linearGradient id="__ID__leaf"><stop stop-color="#295a29"/><stop offset=".5" stop-color="#70a84a"/><stop offset="1" stop-color="#255a2d"/></linearGradient>`);
}

export const records=[
 ...simplyData.map(d=>({slug:d.slug,family:'simply-juice-carafe',packageChoice:`US ${d.size} Simply ${d.kind} clear PET carafe; ${d.kind==='Apple'?'documented Winter Edition Look seasonal label':'documented manufacturer package'} selected for size-unspecified catalog row.`,references:[{pageUrl:`https://www.coca-cola.com/us/en/brands/simply/products/${d.page}`,imageUrl:d.image,inspectedAt:date,visuallyInspected:true,observations:d.observations}],uncertainty:'Exact manufacturer variant visually inspected. Representative US package selected; product-defining fruit, cap, juice color and label retained, lettering and fine text simplified using pinned fonts. Apple seasonal packaging is recorded rather than presented as a permanent label. Final aesthetic approval and native-device review pending.',status:'needs-review',svg:simply(d)})),
 {slug:'welchs-100-grape-juice',family:'welchs-juice-bottle',packageChoice:"US 64 fl oz Welch's 100% Concord Grape Juice PET bottle, original without added calcium/fiber.",references:[{pageUrl:'https://www.kroger.com/p/welch-s-100-concord-grape-juice/0004180020750',imageUrl:'https://www.kroger.com/product/images/large/front/0004180020750',inspectedAt:date,visuallyInspected:true,observations:'Retailer single-bottle photo individually inspected: broad molded PET bottle, very dark purple juice, contoured shoulders, purple ribbed cap, purple grape label with large white curved Welch’s banner and navy lettering, 100% GRAPE JUICE and CONCORD GRAPE, purple/blue grape bunches. Original 64oz product, not the Manischewitz, calcium or fiber formulation.'}],uncertainty:'Manufacturer Concord Grape product route redirected to generic juice listing; retailer exact-product reference used. Tiny label copy and molded detail simplified. Final aesthetic approval and native-device review pending.',status:'needs-review',svg:welch('welchs-100-grape-juice',false)},
 {slug:'welchs-white-grape-juice',family:'welchs-juice-bottle',packageChoice:"US 64 fl oz Welch's 100% White Grape Juice PET bottle.",references:[{pageUrl:'https://welchs.com/en-us/juices/100-percent/white-grape/',imageUrl:'https://img.welchs.com/s--oI9SCW9c--/w_555%2Ch_555/zlqqykwjepubd27qccsd.webp?ts=1793259157642',inspectedAt:date,visuallyInspected:true,observations:'Manufacturer bottle image individually inspected: broad molded bottle with flowing shoulders, pale golden juice, purple ribbed cap, green label with white curved Welch’s banner/navy lettering, large pale green grape bunches, white 100% GRAPE JUICE and WHITE GRAPE. 64oz original White Grape, not sparkling or White Grape Peach.'}],uncertainty:'Manufacturer exact-product reference used; representative 64oz package selected from offered sizes. Fine label copy and certification badges omitted rather than invented. Final aesthetic approval and native-device review pending.',status:'needs-review',svg:welch('welchs-white-grape-juice',true)},
];
