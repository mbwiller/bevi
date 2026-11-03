import {wrap,shadow,ref,text} from '../style.mjs';

// Extend the frozen Mandarin pilot geometry; actual materials, closures and
// flavor labels below follow seven separately inspected manufacturer photos.
const shape='M87 27h26l3 47c0 25 20 40 21 65l3 82q0 14-40 14t-40-14l3-82c1-25 21-40 21-65Z';
const jug=(x,y,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-7-9H4v5c5 0 7 2 6 6-1 3-3 4-6 3v5H-8c-4-3-3-7-1-10l2-3Z M4-1v4q4 0 4-2t-4-2" fill="#078b3e" fill-rule="evenodd" stroke="#fffbe7" stroke-width="1.2"/><path d="M-10 3q4-3 7 0t7 0v7H-8q-3-2-2-7Z" fill="#ec751e"/><path d="M-6-6v4" stroke="#fffbe7" stroke-width="1"/></g>`;
function closure(capped){
 if(!capped)return `<ellipse cx="100" cy="27" rx="13" ry="4" fill="#faf7e9" fill-opacity=".7" stroke="#d1d0b7" stroke-width="2"/><ellipse cx="100" cy="28" rx="9" ry="2" fill="#b0bca8" opacity=".5"/>`;
 return `<path d="M85 22q15-5 30 0l1 8-3 2-3-1-3 2-3-1-3 1-4-1-3 1-4-2-4 1-2-2Z" fill="${ref('metal')}" stroke="#969e98" stroke-width=".6"/>
<ellipse cx="100" cy="22" rx="14.5" ry="3.8" fill="#eef0e9" stroke="#b7bdb3" stroke-width=".65"/>
${Array.from({length:10},(_,i)=>`<path d="M${86.5+i*3} 24v6" stroke="${i%2?'#838e88':'#fffdf3'}" stroke-width=".9"/>`).join('')}
<path d="M87 34q13 4 26 0" fill="none" stroke="#a09c76" stroke-width="1.3"/>`;
}
function draw(d){
 const glass=d.greenGlass?'#78974d':'#e7ead4';
 const label=`
<path d="M66 153q34-8 68 0l2 26q-36 10-72 0Z" fill="#f27720" stroke="#fffbe7" stroke-width="1.7"/>
${jug(99,133,1.22)}${jug(82,147,.88)}${jug(117,147,.88)}
<path d="M68 158q32-6 64 0v17q-32 6-64 0Z" fill="#fffbe7"/>
${text(100,171,'JARRITOS',12,'#07813d','font-weight="bold" letter-spacing="-.3" textLength="61" lengthAdjust="spacingAndGlyphs"')}
${text(100,199,d.name,d.name==='Fruit Punch'?8.2:8.8,'#fffbe9','font-weight="bold" stroke="#397348" stroke-width=".6" paint-order="stroke"')}
${text(100,210,'NATURAL FLAVOR SODA',3.4,'#fff9e5','letter-spacing=".5"')}`;
 return wrap(d.slug,`Jarritos ${d.name}`,`${shadow(54)}
<path d="${shape}" fill="${glass}" fill-opacity="${d.greenGlass?'.62':'.32'}" stroke="${d.greenGlass?'#6b8e46':'#c5cbb4'}" stroke-width="1"/>
<g clip-path="${ref('bodyclip')}">
<path d="M80 70h42v25l17 44 4 101H57l3-101 20-44Z" fill="${ref('soda')}" ${d.greenGlass?'opacity=".5"':''}/>
<ellipse cx="100" cy="76" rx="17" ry="4" fill="${d.line}" opacity=".8"/>
${d.embossed?text(100,116,'JARRITOS',7,d.embossed,'font-weight="bold" letter-spacing=".7" opacity=".25"'):''}
${label}
<path d="${shape}" fill="${ref('glass')}" opacity="${d.greenGlass?'.5':'.75'}"/>
${Array.from({length:23},(_,i)=>`<ellipse cx="${71+(i*19)%57}" cy="${89+(i*31)%131}" rx="${i%4?.55:1}" ry="${i%4?.9:1.4}" fill="#fff" opacity="${d.name==='Guava'?'.15':'.25'}"/>`).join('')}
<path d="M67 218q33 7 66 0" fill="none" stroke="#fff8d4" stroke-opacity=".17" stroke-width="1"/>
</g>
<path d="M89 35 87 78c-1 22-18 40-18 63l-2 72" stroke="#fff" stroke-opacity=".56" stroke-width="3" fill="none"/>
<path d="M126 142 129 217" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
<path d="M110 37 112 75q0 20 12 40" stroke="#fff" stroke-opacity=".16" stroke-width="1.3" fill="none"/>
${closure(d.capped)}
<path d="M86 36q14 5 28 0M86 41q14 5 28 0M66 225q34 9 68 0" fill="none" stroke="#fbf2d6" stroke-opacity=".6" stroke-width="2"/>
<path d="M65 230q35 8 70 0" fill="none" stroke="${d.dark}" stroke-opacity=".55" stroke-width="1.7"/>`,
`<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath><linearGradient id="__ID__soda"><stop stop-color="${d.dark}"/><stop offset=".27" stop-color="${d.light}"/><stop offset=".65" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></linearGradient>`);
}
const data=[
 {slug:'jarritos-lime',name:'Lime',page:'lime',file:'2024/01/Jarritos-Lime-7.jpg',capped:true,color:'#bfda12',light:'#d9ed3e',dark:'#9cb80b',line:'#cce91c',observations:'Manufacturer Lime photo individually inspected: clear long-neck glass bottle, silver crown cap, vivid chartreuse/lime-yellow soda, green three-jug mark with orange lower portions, orange/white banner with green JARRITOS, white Lime lettering with dark-green edge, Natural Flavor Soda underneath. Empty upper neck is clear; liquid is bright green-yellow. Photo volume is not legible.'},
 {slug:'jarritos-fruit-punch',name:'Fruit Punch',page:'fruitpunch',file:'2025/01/Jarritos-Fruit-Punch-3.jpg',capped:true,color:'#e91b27',light:'#ff3d37',dark:'#b90d1f',line:'#ef2a30',observations:'Manufacturer Fruit Punch bottle in ice independently inspected: clear long-neck bottle with silver crown cap and vivid deep-red soda; green/orange three-jug mark, orange/white green-lettered JARRITOS banner, distinct Fruit Punch line and Natural Flavor Soda below. Red liquid differs from lighter coral Guava. Tiny volume text obscured by ice/perspective; exact volume unverified.'},
 {slug:'jarritos-pineapple',name:'Pineapple',page:'pineapple',file:'2025/01/Jarritos-Pineapple-4.jpg',capped:true,color:'#f4cd0c',light:'#ffe43a',dark:'#d8b009',line:'#f9d61e',observations:'Manufacturer Pineapple photo independently inspected: silver-capped clear bottle with long clear headspace and intense yellow soda, green/orange three-jug logo, green JARRITOS in white/orange banner, white Pineapple flavor line and Natural Flavor Soda. Green pineapple leaves in the photo are external styling, not label artwork. Exact bottle volume is not legible.'},
 {slug:'jarritos-grapefruit',name:'Grapefruit',page:'grapefruit',file:'2025/01/Jarritos-Grapefruit-8.jpg',capped:true,greenGlass:true,color:'#d4e4a0',light:'#e4edba',dark:'#8bab45',line:'#c4d986',embossed:'#dce9b3',observations:'Manufacturer Grapefruit close-up independently inspected: green-tinted long-neck glass including empty neck, silver crown cap, pale translucent soda with overall green appearance through glass, embossed shoulder lettering; green/orange jug mark, orange/white banner with green JARRITOS, white Grapefruit flavor and Natural Flavor Soda. Green appearance follows this photo; glass tint is represented separately from liquid. Volume text appears 12.5 FL OZ / 370mL but perspective limits certainty.'},
 {slug:'jarritos-guava',name:'Guava',page:'guava',file:'2024/03/Jarritos-Guava-1.jpg',capped:false,color:'#f3847c',light:'#ffa99c',dark:'#d65f5a',line:'#ff9d92',embossed:'#f8c1ae',observations:'Manufacturer Guava photo independently inspected: open clear long-neck glass bottle, coral-pink slightly cloudy soda, visible empty neck and molded JARRITOS shoulder lettering; green/orange three-jug mark, white/orange banner with green JARRITOS, green-edged white Guava flavor line and Natural Flavor Soda. Side print reads 12.5 FL OZ / 370mL. Closure is intentionally open as photographed.'},
 {slug:'jarritos-tamarind',name:'Tamarind',page:'tamarind',file:'2025/03/Jarritos-Tamarind.jpg',capped:true,color:'#b9782e',light:'#e0a349',dark:'#8f5421',line:'#cd963d',embossed:'#edc282',observations:'Manufacturer Tamarind photo independently inspected: clear long-neck bottle, silver crown cap, amber/light-brown soda with visible headspace, embossed JARRITOS shoulder, green/orange jug mark and green-lettered white/orange banner, white Tamarind with green edge, Natural Flavor Soda and 370mL print. Amber material follows exact photo rather than generic orange coloring.'},
 {slug:'jarritos-watermelon',name:'Watermelon',page:'watermelon',file:'2025/04/Jarritos-Watermelon.jpg',capped:false,color:'#f04c43',light:'#ff7466',dark:'#ce302e',line:'#fa5f54',embossed:'#ffc0a8',observations:'Manufacturer Watermelon photo independently inspected: open clear long-neck bottle, bright red/coral soda, clear headspace, molded JARRITOS shoulder lettering; green/orange jug mark and white/orange wordmark banner, readable Watermelon and Natural Flavor Soda below. Distinct from deeper-red Fruit Punch and pink Guava. Bottle shown open; exact volume not legible.'},
];
export const records=data.map(d=>({slug:d.slug,family:'jarritos-glass-bottle',
 packageChoice:`Manufacturer-documented ${d.name} long-neck glass bottle, ${d.capped?'silver crown closure':'open serving as photographed'}; ${d.name==='Guava'||d.name==='Tamarind'?'370mL marking observed':'exact volume not confidently established from photograph'}.`,
 references:[{pageUrl:`https://jarritos.com/flavor/${d.page}/`,imageUrl:`https://jarritos.com/wp-content/uploads/${d.file}`,inspectedAt:'2026-11-02',visuallyInspected:true,observations:d.observations}],
 uncertainty:'Each exact flavor photo inspected separately. Manufacturer lifestyle photographs, lighting and condensation limit exact color/volume precision; selected appearance and closure are documented per variant. Shared geometry extends the Mandarin pilot, while tint, liquid and flavor lettering follow each reference. Fine molded lettering, tiny legal text and jug details simplified; final aesthetic approval and native-device review pending.',
 status:'needs-review',svg:draw(d)}));
