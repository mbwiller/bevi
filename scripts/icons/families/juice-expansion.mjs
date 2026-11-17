import {wrap,shadow,ref,text} from '../style.mjs';

// Independently inspected US manufacturer packages, 2026-11-04.
const date='2026-11-04';
const leaf=(x,y,s=1,r=0)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C-18-1-23-14-24-22-5-22 6-12 0 0Z" fill="#4b8b37"/><path d="M0 0-22-20m9 11-7-1m12 6-8-1" stroke="#9cbd64" stroke-width=".75" fill="none"/></g>`;
const orange=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><circle r="20" fill="${ref('orange')}"/>${Array.from({length:20},(_,i)=>`<circle cx="${-15+i*17%30}" cy="${-14+i*11%28}" r=".55" fill="#ffd96c" opacity=".55"/>`).join('')}${leaf(4,-14,.55,100)}</g>`;
const apple=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-17C-16-27-26-8-17 9-13 22-6 24 0 20 9 25 19 13 21-2 24-22 8-27 0-17Z" fill="${ref('apple')}"/><path d="M0-15q-1-8 3-15" fill="none" stroke="#6d4028" stroke-width="2"/>${leaf(-2,-16,.45,90)}<path d="M-13-9q-5 7-2 16" stroke="#ffd2aa" stroke-opacity=".55" stroke-width="2.1" fill="none"/></g>`;
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
const minuteData=[{slug:'minute-maid-apple-juice',title:'Minute Maid Apple Juice',color:'#d6b359',light:'#e9d491',dark:'#b1944c',punch:false}];
function record(d,family,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty=''){
 return{slug:d.slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations}],uncertainty:`${uncertainty} Each exact variant reference visually inspected; representative US package chosen because catalog does not specify size. Brand lettering, fruit art and small print simplified original vectors with pinned fonts. Final aesthetic approval and native-device review pending.`,status:'needs-review',svg};
}
export const records=[
 ...tropicana.map(d=>record(d,'tropicana-juice-bottle',`US 46 fl oz Tropicana ${d.title.replace('Tropicana ','')} clear PET bottle.`,`https://www.tropicana.com/products/${d.page}/`,`https://www.tropicana.com/images/products/${d.image}`,d.observations,trop(d),'Manufacturer Current No Pulp/Some Pulp/Refreshers package explicitly selected. Separate catalog Original/No Pulp conflict is not resolved by assigning duplicate artwork.')),
 record(minuteData[0],'minute-maid-juice-bottle','US 12 fl oz / 355mL Minute Maid100% Apple Juice bottle.','https://www.coca-cola.com/us/en/brands/minute-maid/products/minute-maid-variety-juices','https://www.coca-cola.com/content/dam/onexp/us/en/brands/minute-maid/products/variety-juice/minutemaid-prod-apple-allbreakpoints.png','Manufacturer Apple image individually inspected: slim waisted PET bottle with black screw cap and clear neck, predominantly green full-body wrap, tall black Minute Maid shield with white serif lettering, pale-green100% Apple Juice, large white100% Vit C, whole red apple and apple half/leaf at foot,12floz marking. Actual juice mostly concealed by wrap.',minute(minuteData[0])),
];
