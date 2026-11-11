import {wrap,shadow,ref,text} from '../style.mjs';

// Independently inspected US manufacturer packages, 2026-11-04.
const date='2026-11-04';
const leaf=(x,y,s=1,r=0)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C-18-1-23-14-24-22-5-22 6-12 0 0Z" fill="#4b8b37"/><path d="M0 0-22-20m9 11-7-1m12 6-8-1" stroke="#9cbd64" stroke-width=".75" fill="none"/></g>`;
const orange=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><circle r="20" fill="${ref('orange')}"/>${Array.from({length:20},(_,i)=>`<circle cx="${-15+i*17%30}" cy="${-14+i*11%28}" r=".55" fill="#ffd96c" opacity=".55"/>`).join('')}${leaf(4,-14,.55,100)}</g>`;
const apple=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-17C-16-27-26-8-17 9-13 22-6 24 0 20 9 25 19 13 21-2 24-22 8-27 0-17Z" fill="${ref('apple')}"/><path d="M0-15q-1-8 3-15" fill="none" stroke="#6d4028" stroke-width="2"/>${leaf(-2,-16,.45,90)}<path d="M-13-9q-5 7-2 16" stroke="#ffd2aa" stroke-opacity=".55" stroke-width="2.1" fill="none"/></g>`;
const banana=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><circle r="10" fill="#f5dc9e" stroke="#eed09a" stroke-width=".5"/><path d="m0 0 4-5m-4 5-6-2m6 2 2 6m-2-6-1-6" stroke="#d9b66d" stroke-width="1.2" opacity=".7"/><circle r="2" fill="#c6a163" opacity=".45"/></g>`;
const berry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><circle r="8" fill="${ref('berry')}"/><path d="m-3-4 2 2 2-3 1 3 3 1-4 1-1 3-1-3-3-1Z" fill="#35476a"/><ellipse cx="-3" cy="-3" rx="2.2" ry="1.3" fill="#e4edf2" opacity=".5"/></g>`;
const strawberry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12-5Q-15-18-2-15 14-19 14-4 10 11 0 18-9 12-12-5Z" fill="${ref('apple')}"/>${[[-6,-8],[3,-9],[-3,-1],[6,-1],[0,7]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx=".7" ry="1.5" fill="#f1d68e"/>`).join('')}<path d="m-3-14-4-8 8 6 5-7-1 9 8-3-7 7Z" fill="#428b34"/></g>`;
const commonDefs=`<radialGradient id="__ID__orange" cx=".3" cy=".25" r=".8"><stop stop-color="#ffc34e"/><stop offset=".6" stop-color="#f18b13"/><stop offset="1" stop-color="#bf570e"/></radialGradient><radialGradient id="__ID__apple" cx=".28" cy=".22" r=".85"><stop stop-color="#ff8e63"/><stop offset=".45" stop-color="#e7352c"/><stop offset="1" stop-color="#a41623"/></radialGradient><radialGradient id="__ID__berry" cx=".3" cy=".25" r=".8"><stop stop-color="#b0c4d2"/><stop offset=".5" stop-color="#607da6"/><stop offset="1" stop-color="#344e77"/></radialGradient>`;
function cap(color,light,width=34,y=24){
 return `<path d="M${100-width/2} ${y}q ${width/2} -4 ${width} 0v14q ${-width/2} 4 ${-width} 0Z" fill="${color}"/><ellipse cx="100" cy="${y}" rx="${width/2}" ry="3.5" fill="${light}"/>${Array.from({length:17},(_,i)=>`<path d="M${102-width/2+i*(width-4)/16} ${y+2}v10" stroke="${light}" stroke-opacity=".5" stroke-width=".7"/>`).join('')}<path d="M${98-width/2} ${y+15}q ${width/2+2} 4 ${width+4} 0" fill="none" stroke="${light}" stroke-width="1.1"/>`;
}
function finish(d,shape,body,capMarkup,extra=''){
 return wrap(d.slug,d.title,`${shadow(d.shadow||53)}<path d="${shape}" fill="${ref('juice')}" stroke="${d.edge||d.dark}" stroke-width=".7"/>
<g clip-path="${ref('bottleclip')}">${body}<path d="${shape}" fill="${ref('shade')}" opacity=".5"/>
<path d="M${d.left||67} 89V215" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="2.3"/>
<path d="M${d.right||133} 96V216" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="1.4"/></g>${capMarkup}`,
`<clipPath id="__ID__bottleclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__juice"><stop stop-color="${d.dark}"/><stop offset=".24" stop-color="${d.light}"/><stop offset=".55" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></linearGradient>${commonDefs}${extra}`);
}
const tropShape='M85 39h30v15q1 21 13 35 13 15 13 39v91q0 15-15 16H74q-15-1-15-16v-91q0-24 13-39 12-14 13-35Z';
function trop(d){
 const punch=d.flavor==='Fruit Punch';
 const label=`<path d="M59 108q41-9 82 0v114H59Z" fill="#fffdf5"/>
<path d="M59 171h82v51H59Z" fill="${punch?'#39bca9':'#f68c20'}"/>
<ellipse cx="100" cy="110" rx="33" ry="8.5" fill="${d.header}"/>
${text(100,113,d.flavor,6.9,'#fffef4','font-weight="bold"')}
${text(100,139,'Tropicana',18.8,'#0b6335','font-weight="bold" textLength="76" lengthAdjust="spacingAndGlyphs" letter-spacing="-.8"')}
${text(100,150,punch?'REFRESHERS':'PURE PREMIUM',punch?9:5.5,punch?'#8fbe34':'#095d32','font-weight="bold" letter-spacing=".8"')}
${punch?`${apple(101,176,.79)}<path d="m108 165 17 24-29 7Z" fill="#f4c84b" stroke="#e8aa30" stroke-width=".7"/><path d="m113 174 6 12m-13-6 12 1m-8 7 9-9" stroke="#fff0a6" stroke-width="1"/><circle cx="109" cy="199" r="9" fill="#ba1627"/><path d="M109 191q2-13 10-14" stroke="#6c5723" stroke-width="1.1" fill="none"/>${orange(81,193,.55)}`:orange(100,181,1.12)}
<path d="M112 178 128 147" stroke="#fff8e8" stroke-width="3.6"/>
<path d="m115 172 2-4m3-6 2-4m3-6 2-4" stroke="#d34b3d" stroke-width="3.6"/>
${text(100,218,punch?'FRUIT JUICE DRINK':'100% Orange Juice',4.1,'#fffdf2','font-weight="bold"')}`;
 const body=`<path d="M87 45q-2 26-13 45-10 18-10 37" fill="none" stroke="#fff5ae" stroke-opacity=".55" stroke-width="3"/><path d="M112 45q2 24 14 45" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.8"/>${label}<path d="M65 226q35 7 70 0" stroke="#fff6b7" stroke-opacity=".35" stroke-width="1.4" fill="none"/>`;
 return finish(d,tropShape,body,cap(punch?'#00713b':'#f39225',punch?'#15985c':'#ffba4b',36), '');
}
const tropicana=[
 {slug:'tropicana-orange-juice-no-pulp',title:'Tropicana Pure Premium No Pulp',flavor:'No Pulp',page:'original',image:'tropicana-pure-premium-no-pulp-320.png',header:'#ef7c1f',color:'#ffcd20',light:'#ffe349',dark:'#e7a90e',observations:'Exact manufacturer 46oz image inspected: clear tall rounded PET bottle, orange ribbed cap, opaque yellow/orange juice, white upper label with orange No Pulp oval, green Tropicana/PURE PREMIUM, orange lower panel, whole orange/leaf and striped straw. The manufacturer calls this Original (No Pulp). Only the explicit catalog No Pulp UUID is authored; separate Original row requires duplicate-identity reconciliation.'},
 {slug:'tropicana-orange-juice-some-pulp',title:'Tropicana Pure Premium Some Pulp',flavor:'Some Pulp',page:'some-pulp',image:'tropicana-pure-premium-homestyle-some-pulp-320.png',header:'#008541',color:'#ffd027',light:'#ffe84b',dark:'#e7ad12',observations:'Separate manufacturer 46oz Some Pulp image inspected: rounded clear bottle/orange cap, opaque orange juice, green Some Pulp oval above green Tropicana PURE PREMIUM; orange lower panel and whole orange/leaf with striped straw. Some Pulp is confirmed by actual label, independently from No Pulp.'},
 {slug:'tropicana-fruit-punch',title:'Tropicana Refreshers Fruit Punch',flavor:'Fruit Punch',page:'fruit-punch',image:'tropicana-fruit-punch-320.png',header:'#e92528',color:'#eb4b42',light:'#ff8173',dark:'#b82d30',observations:'Manufacturer 46oz Fruit Punch image inspected: clear rounded bottle with green ribbed cap and coral/red juice, red Fruit Punch oval, green Tropicana, lime-green REFRESHERS, white upper/teal lower label, apple/orange/pineapple/cherry fruit arrangement and striped straw. Manufacturer identifies this exact flavor as formerly Caribbean Sunset; Original Fruit Punch, not Zero Sugar.'},
];

const nakedShape='M77 40h46v17q0 7 10 13 12 9 12 20v130q0 14-13 15H68q-13-1-13-15V90q0-11 12-20 10-6 10-13Z';
function kiwi(x,y,s=1){return `<g transform="translate(${x} ${y}) scale(${s})"><circle r="12" fill="#9dba45" stroke="#8d803a" stroke-width="1"/><circle r="9.5" fill="#b6d45a"/>${Array.from({length:13},(_,i)=>{const a=i*Math.PI*2/13;return `<ellipse cx="${Math.cos(a)*6.5}" cy="${Math.sin(a)*6.5}" rx=".6" ry="1.2" transform="rotate(${i*360/13} ${Math.cos(a)*6.5} ${Math.sin(a)*6.5})" fill="#3b4d25"/>`;}).join('')}<ellipse rx="3" ry="4" fill="#e4e4a6"/></g>`;}
function naked(d){
 const green=d.key==='green',blue=d.key==='blue',mango=d.key==='mango';
 const first=green?'GREEN':blue?'BLUE':mango?'MIGHTY MANGO':'STRAWBERRY';
 const names=green||blue||mango?`${text(100,148,first,mango?11.7:17,d.ink,'font-weight="900" textLength="80" lengthAdjust="spacingAndGlyphs"')}${text(100,162,'MACHINE',14.4,d.ink,'font-weight="900" textLength="80" lengthAdjust="spacingAndGlyphs"')}`:`${text(100,144,first,9.3,d.ink,'font-weight="900" textLength="80" lengthAdjust="spacingAndGlyphs"')}${text(100,154,'BANANA',12.5,d.ink,'font-weight="900" textLength="80" lengthAdjust="spacingAndGlyphs"')}${text(100,166,'MACHINE',12.6,d.ink,'font-weight="900" textLength="80" lengthAdjust="spacingAndGlyphs"')}`;
 const fruit=green?`${orange(101,193,.95)}${kiwi(116,178,.95)}<path d="M67 201q1-17 22-17l10 13Z" fill="#b7cf8b"/><path d="M70 198q7-9 23-7" stroke="#edf4ce" stroke-width="5"/>${banana(90,207,.83)}`:blue?`${apple(98,199,.87)}${banana(119,181,.82)}${banana(130,184,.68)}${berry(73,189,.85)}${berry(70,207,.9)}${berry(125,205,.92)}${berry(110,214,.7)}`:mango?`<ellipse cx="109" cy="195" rx="23" ry="28" transform="rotate(20 109 195)" fill="#d78b45"/><ellipse cx="109" cy="195" rx="21" ry="25" transform="rotate(20 109 195)" fill="#ffc431"/><path d="M91 176q18-7 30 9" stroke="#ffe47e" stroke-opacity=".5" stroke-width="2" fill="none"/>${banana(88,177,.8)}${orange(76,204,.57)}`:`${strawberry(99,188,.94)}${banana(74,205,.8)}${banana(90,209,.86)}<path d="M108 203q10-23 23-14l-5 21Z" fill="#fff0c5" stroke="#ce6b67" stroke-width="2"/>${strawberry(118,212,.7)}`;
 const body=`<path d="M80 47v12q-15 12-19 21" stroke="#fff" stroke-opacity=".3" stroke-width="3.1" fill="none"/><path d="M56 91h88v125H56Z" fill="${d.label}"/>
${Array.from({length:15},(_,i)=>`<path d="m${57+i*17%86} ${94+i*13%114} 9-4 11 7-8 10-12-4Z" fill="#fff" opacity=".065"/>`).join('')}
<path d="M67 103q18-7 35-3t32-1l-1 26q-34-2-65 3Z" fill="#28266d"/>
${text(100,120,'Naked',21,'#fffef2','letter-spacing="-1" textLength="60" lengthAdjust="spacingAndGlyphs"')}
<path d="M105 106q4-5 9-4-2 5-9 4Z" fill="#c9d630"/>
${text(100,130,'BOOSTED SMOOTHIE',4.7,'#2c2867','font-weight="bold" textLength="77" lengthAdjust="spacingAndGlyphs"')}
${names}${fruit}
${text(77,212,'15.2 FL OZ',3.4,d.ink)}
<path d="M59 222q41 7 82 0" stroke="#fff" stroke-opacity=".15" stroke-width="1.8" fill="none"/>`;
 return finish({...d,left:61,right:140,shadow:55},nakedShape,body,cap('#2c2794','#564fc4',55,24));
}
const nakedData=[
 {slug:'naked-juice-green-machine',key:'green',title:'Naked Green Machine',page:'green-machine',image:'machine-green.png',color:'#6f763a',light:'#8c914d',dark:'#535b28',label:'#badd80',ink:'#00733e',observations:'Manufacturer current 15.2oz Green Machine front bottle individually inspected: stout straight-sided clear PET with short shoulders and wide blue ribbed cap; olive-green smoothie, light-green wrap, white Naked in blue banner, BOOSTED SMOOTHIE and bold green GREEN MACHINE; kiwi, mango, apple/banana and vegetable fruit arrangement. Current label explicitly includes fiber/vitamins; tiny claims omitted.'},
 {slug:'naked-juice-blue-machine',key:'blue',title:'Naked Blue Machine',page:'blue-machine',image:'machine-blue.png',color:'#793d63',light:'#9b5a7d',dark:'#572c4d',label:'#a2d7ed',ink:'#225b94',observations:'Separate manufacturer current 15.2oz Blue Machine photo inspected: wide blue cap, purple/magenta smoothie in clear stout bottle, light-blue wrap, Naked white/blue banner, BOOSTED SMOOTHIE and bold blue BLUE MACHINE; apple slices, blueberries and banana slices. Juice is purple, not blue; current fiber/vitamin variant explicitly recorded.'},
 {slug:'naked-juice-mighty-mango',key:'mango',title:'Naked Mighty Mango Machine',page:'mighty-mango-machine',image:'machine-mighty-mango.png',color:'#ef981b',light:'#ffb939',dark:'#ca7414',label:'#ffd068',ink:'#cc4f2c',observations:'Separate manufacturer 15.2oz Mighty Mango Machine photo inspected: opaque orange smoothie, blue cap, yellow/orange wrap, white/blue Naked banner, BOOSTED SMOOTHIE; narrow orange MIGHTY MANGO above bold MACHINE, mango half/orange wedge/banana fruit art. Exact current product called Mighty Mango Machine; current name/formulation selection explicitly recorded.'},
 {slug:'naked-juice-strawberry-banana',key:'red',title:'Naked Strawberry Banana Machine',page:'strawberry-banana-machine',image:'machine-red.png',color:'#b37b65',light:'#d49b80',dark:'#965e51',label:'#f4b495',ink:'#b8292c',observations:'Separate manufacturer 15.2oz Strawberry Banana Machine photo inspected: muted brownish-pink smoothie, wide blue cap, peach/pink wrap, white/blue Naked banner, BOOSTED SMOOTHIE and stacked red STRAWBERRY / BANANA / MACHINE; strawberries, banana slices and apple slice. Current Machine branding/fiber-vitamin variant is documented rather than assuming the older label/formula.'},
];

const mottsShape='M84 39h32q-3 8 5 16l-1 16q0 12 19 30 12 11 12 28v86q-1 18-15 20H64q-14-2-15-20v-86q0-17 12-28 19-18 19-30l-1-16q8-8 5-16Z';
function motts(d){
 const body=`<path d="M84 44h32q12 14-1 25H85q-13-11-1-25Z" fill="#eec65b" opacity=".5"/>
${Array.from({length:12},(_,i)=>{const x=63+i*6.7;return `<path d="M${84+i*2.7} 75 ${x} 105v7" stroke="#fff7be" stroke-opacity=".55" stroke-width="1.3" fill="none"/>`;}).join('')}
<path d="M49 117h102v100H49Z" fill="#ffe333"/>
${text(100,133,'since 1842',3.3,'#202724','font-style="italic"')}
${text(100,150,"MOTT'S",22,'#131a13','font-weight="900" letter-spacing="-.9" textLength="86" lengthAdjust="spacingAndGlyphs"')}
<path d="M49 156h43v61H49Z" fill="#00a950"/>
${text(71,171,'100%',9.5,'#fffef0','font-weight="bold"')}${text(71,181,'JUICE',9,'#fffef0','font-weight="bold"')}${text(71,197,'APPLE',6.5,'#fffef0','font-weight="bold"')}
${apple(118,188,1.03)}
${text(114,215,'64 FL OZ',3.3,'#343723')}
<path d="M57 223q43 10 86 0" stroke="#ffe3a0" stroke-opacity=".55" stroke-width="2" fill="none"/>
<ellipse cx="100" cy="228" rx="26" ry="5" fill="none" stroke="#bd872c" stroke-width=".7"/>
<path d="M85 52q-8 10-2 20" stroke="#fff7c4" stroke-opacity=".5" stroke-width="2" fill="none"/>`;
 return finish({...d,left:56,right:145,shadow:61},mottsShape,body,cap('#dfba16','#ffde48',34));
}
const minuteAppleShape='M82 40h36v17q0 8 13 13 10 5 9 21l-7 50 7 73q2 19-12 21H72q-14-2-12-21l7-73-7-50q-1-16 9-21 13-5 13-13Z';
const minutePunchShape='M85 40h30v17q1 9 10 24l17 31q2 7 0 15v45q-2 9-7 15l-2 24 8 15q0 9-9 9l-13-3q-9 8-18 0-10 8-20 0l-12 3q-10 0-10-9l8-15-2-24q-5-6-7-15v-45q-2-8 0-15l17-31q9-15 10-24Z';
function minute(d){
 const punch=d.punch;
 const brand=(y)=>`${text(101,y,'Minute',11.4,'#fffdf2','style="font-family:Georgia,serif;font-weight:bold" textLength="44" lengthAdjust="spacingAndGlyphs"')}${text(100,y+13,'Maid',13.1,'#fffdf2','style="font-family:Georgia,serif;font-weight:bold"')}`;
 let body;
 if(punch){body=`<path d="M85 43h30l2 20H83Z" fill="#fff" fill-opacity=".76"/>
<path d="M58 124h84v52H58Z" fill="#408fdb"/><path d="M58 124h84v3H58ZM58 173h84v3H58Z" fill="#f32d2a"/>
${orange(80,140,.55)}<path d="m125 135 11 12-15 7Z" fill="#ffe35d"/>${orange(70,164,.48)}
<path d="M78 135q11-2 22 3 12-10 23-10v42H78Z" fill="#151918"/>
${brand(151)}<path d="M78 165h45v9H78Z" fill="#ed2923"/>${text(100,171,'Fruit Punch',5.7,'#fffdf2','style="font-family:Georgia,serif;font-weight:bold"')}
${Array.from({length:48},(_,i)=>`<circle cx="${72+i%8*8}" cy="${187+Math.floor(i/8)*5}" r=".7" fill="#880f1c" opacity=".35"/>`).join('')}
<path d="M65 180q35 5 70 0M67 218q33 7 66 0" stroke="#ed7665" stroke-opacity=".4" stroke-width="1.4" fill="none"/>`;
 }else{body=`<path d="M82 42h36v20H82Z" fill="#e7e8d5" opacity=".72"/><path d="M60 75q40-12 80 0v160H60Z" fill="#70bf43"/>
<path d="M79 87q13-1 22 5 10-11 24-11l-5 106-43 5Z" fill="#171b18"/>
${brand(111)}${text(100,144,'100%',8.5,'#b9d56b','style="font-family:Georgia,serif"')}${text(100,155,'Apple Juice',6.8,'#b9d56b','style="font-family:Georgia,serif"')}
${text(100,174,'100%',13,'#fffef2','style="font-family:Georgia,serif"')}${text(100,187,'Vit C',12.4,'#fffef2','style="font-family:Georgia,serif"')}
<path d="M84 192q-20 4-12 21 5 9 15 5 8 4 13-8 5-18-16-18Z" fill="#fff1c5" stroke="#b37c35" stroke-width=".6"/><path d="M86 195v20" stroke="#c6b768" stroke-width=".7"/><ellipse cx="83" cy="207" rx=".9" ry="2.1" fill="#80502e"/>
${apple(115,213,.69)}${text(100,230,'12 FL OZ',3.5,'#283c20')}`;
 }
 return finish({...d,left:punch?65:64,right:punch?136:137,shadow:53},punch?minutePunchShape:minuteAppleShape,body,cap('#242826','#414944',35,26));
}
const mottsData={slug:'motts-apple-juice',title:"Mott's 100% Apple Juice",color:'#ce991b',light:'#ebc54f',dark:'#a16f16'};
const minuteData=[{slug:'minute-maid-apple-juice',title:'Minute Maid Apple Juice',color:'#d6b359',light:'#e9d491',dark:'#b1944c',punch:false},{slug:'minute-maid-fruit-punch',title:'Minute Maid Fruit Punch',color:'#c6272e',light:'#e65e5c',dark:'#9e1b2a',punch:true}];
function record(d,family,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty=''){
 return{slug:d.slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations}],uncertainty:`${uncertainty} Each exact variant reference visually inspected; representative US package chosen because catalog does not specify size. Brand lettering, fruit art and small print simplified original vectors with pinned fonts. Final aesthetic approval and native-device review pending.`,status:'needs-review',svg};
}
export const records=[
 ...tropicana.map(d=>record(d,'tropicana-juice-bottle',`US 46 fl oz Tropicana ${d.title.replace('Tropicana ','')} clear PET bottle.`,`https://www.tropicana.com/products/${d.page}/`,`https://www.tropicana.com/images/products/${d.image}`,d.observations,trop(d),'Manufacturer Current No Pulp/Some Pulp/Refreshers package explicitly selected. Separate catalog Original/No Pulp conflict is not resolved by assigning duplicate artwork.')),
 ...nakedData.map(d=>record(d,'naked-smoothie-bottle',`US 15.2 fl oz / 450mL ${d.title}, current manufacturer Boosted Smoothie / Machine package.`,`https://www.nakedsmoothie.com/our-products/machines/${d.page}`,`https://www.nakedsmoothie.com/storage/app/media/2025/products/${d.image}`,d.observations,naked(d),'Current manufacturer flavor variant is explicitly selected; catalog has no formula/vintage metadata. This does not assert nutritional equivalence with older Naked Juice labels. Current Boosted Smoothie/Machine wording retained, nutritional claims omitted.')),
 record(mottsData,'motts-juice-bottle',"US 64 fl oz / 1.89L Mott's original100% Apple Juice bottle.",'https://www.motts.com/products/juice/motts-100-original-apple-juice','https://www.motts.com/images/products/sizes/motts-100-original-apple-juice_64.png','Manufacturer64oz Original Apple photo individually inspected: clear wide molded bottle, amber juice, small yellow ribbed cap, fluted shoulders, yellow upper/green lower label, large black angular MOTT’S, white100% JUICE/APPLE, red apple and green leaf; transparent molded base. Not Natural, Organic, Light or Tots.',motts(mottsData)),
 record(minuteData[0],'minute-maid-juice-bottle','US 12 fl oz / 355mL Minute Maid100% Apple Juice bottle.','https://www.coca-cola.com/us/en/brands/minute-maid/products/minute-maid-variety-juices','https://www.coca-cola.com/content/dam/onexp/us/en/brands/minute-maid/products/variety-juice/minutemaid-prod-apple-allbreakpoints.png','Manufacturer Apple image individually inspected: slim waisted PET bottle with black screw cap and clear neck, predominantly green full-body wrap, tall black Minute Maid shield with white serif lettering, pale-green100% Apple Juice, large white100% Vit C, whole red apple and apple half/leaf at foot,12floz marking. Actual juice mostly concealed by wrap.',minute(minuteData[0])),
 record(minuteData[1],'minute-maid-juice-bottle','US 20 fl oz / 591mL Minute Maid Fruit Punch contoured PET bottle.','https://www.coca-cola.com/us/en/brands/minute-maid/products/lemonades-and-fruit-drinks','https://www.coca-cola.com/content/dam/onexp/us/en/brands/minute-maid/products/lemonades/mm-lem-fruit-drinks-product-img-fruit-punch.jpg','Manufacturer Fruit Punch image individually inspected: black screw cap, clear neck/headspace, red drink in contoured bottle with tapered shoulders, blue center wrap with orange/pineapple/pear fruit art, black Minute Maid shield/white lettering, red Fruit Punch bar; dimpled waist and petaloid base.20fl oz label; not Zero Sugar or Tropical Punch.',minute(minuteData[1])),
];
