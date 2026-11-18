import {wrap,shadow,ref,text} from '../style.mjs';

// Independently inspected US manufacturer packages, 2026-11-04.
const date='2026-11-04';
const leaf=(x,y,s=1,r=0)=>`<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C-18-1-23-14-24-22-5-22 6-12 0 0Z" fill="#4b8b37"/><path d="M0 0-22-20m9 11-7-1m12 6-8-1" stroke="#9cbd64" stroke-width=".75" fill="none"/></g>`;
const orange=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><circle r="20" fill="${ref('orange')}"/>${Array.from({length:20},(_,i)=>`<circle cx="${-15+i*17%30}" cy="${-14+i*11%28}" r=".55" fill="#ffd96c" opacity=".55"/>`).join('')}${leaf(4,-14,.55,100)}</g>`;
const apple=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-17C-16-27-26-8-17 9-13 22-6 24 0 20 9 25 19 13 21-2 24-22 8-27 0-17Z" fill="${ref('apple')}"/><path d="M0-15q-1-8 3-15" fill="none" stroke="#6d4028" stroke-width="2"/>${leaf(-2,-16,.45,90)}<path d="M-13-9q-5 7-2 16" stroke="#ffd2aa" stroke-opacity=".55" stroke-width="2.1" fill="none"/></g>`;
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


function record(d,family,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty=''){
 return{slug:d.slug,family,packageChoice,references:[{pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations}],uncertainty:`${uncertainty} Each exact variant reference visually inspected; representative US package chosen because catalog does not specify size. Brand lettering, fruit art and small print simplified original vectors with pinned fonts. Final aesthetic approval and native-device review pending.`,status:'needs-review',svg};
}
export const records=[
 ...tropicana.map(d=>record(d,'tropicana-juice-bottle',`US 46 fl oz Tropicana ${d.title.replace('Tropicana ','')} clear PET bottle.`,`https://www.tropicana.com/products/${d.page}/`,`https://www.tropicana.com/images/products/${d.image}`,d.observations,trop(d),'Manufacturer Current No Pulp/Some Pulp/Refreshers package explicitly selected. Separate catalog Original/No Pulp conflict is not resolved by assigning duplicate artwork.')),
];
