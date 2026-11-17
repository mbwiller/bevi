// Redraws of three energy-drink icons marked Needs work in the 2026-11-15 review:
// alani-nu-mimosa, bang-rainbow-unicorn and celsius-cucumber-lime. The rejected recipes
// were in refreshments-12.mjs. The can() helper and the three brand marks (Alani script,
// Bang target "b", Celsius C) are copied from energy-expansion.mjs, whose icons of the
// sibling flavors were sorted Good, so each family keeps one silhouette and one mark.
import {wrap,shadow,ref,text} from '../style.mjs';

const n=v=>Math.round(v*100)/100;
const pol=(r,a)=>`${n(r*Math.cos(a*Math.PI/180))} ${n(r*Math.sin(a*Math.PI/180))}`;
const ltext=(x,y,label,size,fill,attrs='')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${fill}" ${attrs}>${label}</text>`;

// Copied unchanged from energy-expansion.mjs (slim, narrow and 16 oz widths).
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
const whiteCan=`<linearGradient id="__ID__white"><stop stop-color="#b7c0bd"/><stop offset=".25" stop-color="#fafbf6"/><stop offset=".58" stop-color="#eef0eb"/><stop offset="1" stop-color="#b9c3bf"/></linearGradient>`;
const date='2026-11-15';

// ───────────────────────── Alani Nu Mimosa ─────────────────────────
// The vertical script is the mark of the Good Alani cans, geometry unchanged.
const alaniScript=c=>`<g transform="translate(105 174) rotate(-90) scale(.8 .65)" fill="none" stroke="${c}" stroke-width="5.3" stroke-linecap="round" stroke-linejoin="round">
<path d="M0 9Q17-14 31-22L14 12M9 0 27-2M16 11q13-3 27-31 7-13 0-11-10 6-12 29-1 16 11 3M43 0q12-16 18-7 1 10-11 13-10 0-6-9M60-7l-4 15q4 2 12-10l8-8-6 18q3 3 11-6M82-3 76 9q1 4 11-5"/>
<path d="m88-15 1-1"/>
</g>`;
// Citrus slice drawn at radius 10 and scaled: orange rind with a peach stretch, pale pith,
// rounded segments shaded from peach at the core to orange, pulp flecks and a rind glint.
// from/to select the visible sector in degrees (clockwise from +x); sx narrows a slice
// that sits on the turning edge of the can.
function citrus(x,y,r,rot,{from=0,to=360,peach=[215,300],glint=120,sx=1}={}){
  const full=to-from>=360,span=to-from;
  const sector=(R,fill)=>full?`<circle r="${R}" fill="${fill}"/>`:`<path d="M${pol(R,from)}A${R} ${R} 0 ${span>180?1:0} 1 ${pol(R,to)}Z" fill="${fill}"/>`;
  const segs=[];
  for(let a=Math.ceil(from/45)*45;a+45<=to;a+=45){
    segs.push(`<path d="M${pol(2.1,a+22.5)}L${pol(6.9,a+6.2)}A6.9 6.9 0 0 1 ${pol(6.9,a+38.8)}Z" fill="${ref('pulp')}" stroke="${ref('pulp')}" stroke-width=".9" stroke-linejoin="round"/>`);
    const k=(a+360)/45;
    segs.push(`<path d="M${pol(4.3,a+15+k%2*4)}L${pol(5.3,a+15+k%2*4)}M${pol(5.1,a+29-k%3*2)}L${pol(6,a+29-k%3*2)}M${pol(3.5,a+23)}L${pol(4.2,a+23)}" stroke="#fdf0bd" stroke-width=".38" stroke-linecap="round"/>`);
  }
  const arc=(R,a0,a1)=>`M${pol(R,a0)}A${R} ${R} 0 0 1 ${pol(R,a1)}`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${n(r/10*sx)} ${n(r/10)})">${sector(10,'#f07d3c')}<path d="${arc(9.3,peach[0],peach[1])}" fill="none" stroke="#f8c4a6" stroke-width="1.4"/>${sector(8.6,'#f9ee9f')}${segs.join('')}<path d="${arc(9.3,glint,glint+15)}" fill="none" stroke="#fff" stroke-width=".7" stroke-linecap="round"/><path d="${arc(9.3,glint+23,glint+24)}" fill="none" stroke="#fff" stroke-width=".7" stroke-linecap="round"/></g>`;
}
const bubble=(x,y,rx,ry=rx)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${ref('fizz')}"/><ellipse cx="${n(x-rx*.3)}" cy="${n(y-ry*.38)}" rx="${n(rx*.3)}" ry="${n(ry*.24)}" fill="#fff" opacity=".75"/>`;
const mintLeaf=(x,y,s,rot)=>`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0C-7-5-8-14 0-22 8-14 7-5 0 0Z" fill="#2eb39b"/><path d="M0 0C-7-5-8-14 0-22Z" fill="#a4decd"/></g>`;
// Branching splash shapes: round-capped strokes in one paint, each finger ending in a
// slightly swollen drop (the stroke's last point repeated as a heavier dot).
const fingers=(paint,list)=>`<g fill="none" stroke="${paint}" stroke-linecap="round" stroke-linejoin="round">${list.map(([d,w,tip])=>`<path d="${d}" stroke-width="${w}"/>${tip?`<path d="M${tip}v.01" stroke-width="${n(w*1.32)}"/>`:''}`).join('')}</g>`;
function alaniMimosa(){
  const slug='alani-nu-mimosa',teal='#4fcdb9',orange='#eb6a17';
  const art=`${mintLeaf(74,53,.75,-14)}${citrus(77,51,10.5,-30,{from:0,to:180,peach:[4,62],glint:128})}
${citrus(125,44.5,11,0,{peach:[20,80],glint:140})}
${fingers(ref('coralA'),[['M114.4 40C114.6 45 113.8 49 113.4 53 113.1 56.5 112 58.6 111.6 61',3.5,'111.6 61'],['M114 45C110.5 44.2 107 47.4 102.4 46.9',3.6,'102.4 46.9'],['M113.4 52.4C111.2 52.2 110 53.9 108.2 53.8',3.2,'108.2 53.8'],['M114.6 49.2C116.2 50.2 116.8 52 118.2 52.6',2.4,'118.2 52.6']])}
${bubble(124.6,62.5,2.6,4.6)}${bubble(127.2,73.5,1.4,2.1)}${bubble(124.2,79,.8,1.1)}
${mintLeaf(76,203.5,.72,-24)}${citrus(67.6,173,17,5,{from:-90,to:90,peach:[-88,-24],glint:48,sx:.8})}
${bubble(85.2,170.5,2.6)}${bubble(73,203.4,4.3,6.4)}${bubble(86.4,198.8,3.3)}${bubble(80.3,213.2,2.8)}${bubble(88.4,209.4,1.6)}
${bubble(129,153.5,2.7,8)}${bubble(123.6,167.6,2.4,2.9)}${bubble(127.8,175,2.2,4.4)}${bubble(124.8,182.4,1.9,2.5)}${bubble(128.8,186.4,1.6,3.6)}${bubble(131.4,193.5,.9,2.6)}
${[[119.6,161.5],[124.8,160.6],[119.2,174.4],[131,165.5],[83.4,205.6],[90.6,203.4]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".55" fill="#f2e257"/>`).join('')}
${mintLeaf(115.5,204,.8,24)}
${fingers(ref('coralC'),[['M90.4 217.6C87.6 215.4 85.8 211 81.4 207.6',3.7,'81.4 207.6']])}${fingers(ref('coralB'),[['M92 224C92 219 93.6 215 95.4 211.4 97.2 207.6 97.7 202 97.4 197.4',4.1,'97.4 197.4'],['M93 215C92 211.8 92 209 91.3 206.6',3.3,'91.3 206.6'],['M90.5 221.6C88.2 222.3 86.6 220.2 85 219.6',3.5,'85 219.6']])}
${citrus(110.8,216.8,17.5,0,{peach:[281,344],glint:205})}${citrus(134.6,215.5,8,-12,{from:90,to:270,peach:[100,101],glint:400})}
<path d="M122.7 198.2 127 200.9V209.1L122.7 211.8 118.4 209.1V200.9Z" fill="#cf5810" stroke="#cf5810" stroke-width="1.6" stroke-linejoin="round"/>${text(122.7,205.2,'0',5.8,'#fffaf0','font-weight="bold"')}${text(122.7,208.6,'SUGAR',2.3,'#fffaf0','font-weight="bold" font-style="italic"')}`;
  const label=`${art}<path d="M65 26h70v16H65Z" fill="${orange}"/>
${text(100,70,'MIMOSA',6.1,'#dd641d','font-weight="bold" letter-spacing="1.7"')}${text(100,77.4,'NATURALLY FLAVORED',3.25,'#dd641d','letter-spacing=".25"')}
${alaniScript(teal)}<g transform="translate(118 126) rotate(-90)">${text(0,0,'NU',11,teal,'letter-spacing="3"')}</g>
${text(101.5,185.4,'ENERGY',8,ref('energy'),'font-style="italic" textLength="34" lengthAdjust="spacingAndGlyphs"')}
<path d="M65 222q35 4 70 0v11H65Z" fill="#47c3ae"/>${text(100,229,'12 FL OZ',3.5,'#f9f8e7')}`;
  const defs=`${whiteCan}<radialGradient id="__ID__pulp" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="7.4"><stop offset=".2" stop-color="#f9c3a3"/><stop offset=".62" stop-color="#f6935b"/><stop offset="1" stop-color="#f1773a"/></radialGradient><radialGradient id="__ID__fizz" cx=".42" cy=".4" r=".62"><stop stop-color="#fdf8c4"/><stop offset=".55" stop-color="#f7ec7a"/><stop offset="1" stop-color="#efdc48"/></radialGradient><linearGradient id="__ID__coralA" gradientUnits="userSpaceOnUse" x1="0" y1="42" x2="0" y2="61"><stop stop-color="#9354b4"/><stop offset=".5" stop-color="#c95fae"/><stop offset="1" stop-color="#f0709f"/></linearGradient><linearGradient id="__ID__coralB" gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="223"><stop stop-color="#f172b0"/><stop offset=".55" stop-color="#e96cb4"/><stop offset="1" stop-color="#a45fc6"/></linearGradient><linearGradient id="__ID__coralC" gradientUnits="userSpaceOnUse" x1="80" y1="206" x2="91" y2="220"><stop stop-color="#f7a9a6"/><stop offset="1" stop-color="#f083ae"/></linearGradient><linearGradient id="__ID__energy" gradientUnits="userSpaceOnUse" x1="85" y1="0" x2="119" y2="0"><stop stop-color="#e867a7"/><stop offset="1" stop-color="#9c5cc0"/></linearGradient>`;
  return {slug,family:'alani-slim-can',
    packageChoice:'US 12 fl oz / 355 mL Alani Nu Energy Mimosa slim can, the white-bodied retail can with orange neck and mint foot. Mimosa is not in the manufacturer\'s current product feed (alaninu.com/products.json, checked 2026-11-15), so this is the last retail package of a retired flavor rather than a current listing.',
    references:[{pageUrl:'https://shop.fivestarbreaktime.com/product/alani-nu-energy-mimosa-12oz-can/',imageUrl:'https://ocs-images.nywebconsulting.com/121824.jpg',inspectedAt:date,visuallyInspected:true,
      observations:'Distributor front packshot (1625 px render) of the 12 fl oz can: pearl-white body, solid orange neck band, small spaced orange MIMOSA with thin NATURALLY FLAVORED beneath, vertical mint Alani script with thin NU beside it, italic ENERGY in a pink-to-purple fade, mint foot band with white 12 FL OZ (355ML). Flavor art around the edges: half orange slices with a peach stretch of rind and pale-yellow pith at upper left and middle left, an orange wheel cut off by the neck at upper right and a large one rising from the foot band, pink/purple branching splash shapes at top and bottom, yellow bubbles down both sides, two-tone mint leaves, and an orange hexagon 0 SUGAR badge at lower right.'}],
    uncertainty:'Catalog has no package size; the 12 fl oz can is the only one found. Script wordmark keeps the geometry of the Good Alani icons, so it is shorter than on the photographed can (about 34% of the can height against 40%), and NU is set in Arial rather than the can\'s thin bracket-style letters. ENERGY is set smaller than on the sibling icons to match this can and clear the fruit. Bubble and splash positions follow the reference but are simplified; halftone grain on the fruit, ENERGY DRINK and (355ML) in the foot band are omitted. Current availability not confirmed: retailer listings exist, the manufacturer no longer lists the flavor.',
    status:'needs-review',svg:can(slug,'Alani Nu Energy Mimosa',label,{narrow:true,color:ref('white'),defs})};
}

// ───────────────────────── Bang Rainbow Unicorn ─────────────────────────
// Same target "b", wordmark and layout as the Good Bang cans (function bang in
// energy-expansion.mjs); this flavor's own teal, pink and yellow, pink stripe and foot.
function bangRainbowUnicorn(){
  const slug='bang-rainbow-unicorn',c='#10a2bf',inner='#f0638a',pink='#ee5c84',yellow='#f6e24d',ink='#172c47';
  const b='M-24-43h12v22q25-10 31 12t-11 38q-23 10-35-14V-43Z';
  const label=`<path d="M57 26h86v17H57Z" fill="${c}"/>${text(100,37,'FUEL YOUR DESTINY',5.3,'#fff9ed','font-weight="bold" font-style="italic" textLength="72" lengthAdjust="spacingAndGlyphs"')}<path d="M58 42h84v181H58Z" fill="#f2f6ee"/><path d="M57 44.6h86" stroke="${pink}" stroke-width="1.5"/>
<path d="M57 184Q59.5 215 82 229H57ZM143 184Q140.5 215 118 229H143Z" fill="${c}"/><path d="M61.5 181Q63.5 210 83 225.5M138.5 181Q136.5 210 117 225.5" fill="none" stroke="${pink}" stroke-width=".9"/>
<path d="M66 49v124m-5-122v120m76-123v125" stroke="${c}" stroke-width=".7" opacity=".5"/>
<g transform="translate(100 96)"><path d="${b}" fill="#fffdf5"/><g clip-path="${ref('bclip')}"><path d="${b}" transform="translate(-3.4 -3)" fill="none" stroke="${yellow}" stroke-width="2.6"/></g><path d="${b}" fill="none" stroke="${ink}" stroke-width="4"/><path d="${b}" fill="none" stroke="${c}" stroke-width="1.6"/><circle r="17" fill="${inner}" stroke="#1c2b3a" stroke-width="2"/><path d="M-11-4h-21m47 0h16m-32-26v15m0 30v23" stroke="#1b344d" stroke-width="4"/><path d="M-11-4h-21m47 0h16m-32-26v15m0 30v23" stroke="${c}" stroke-width="1.5"/><path d="M-6-4q12 12 11-9-10 3-5 10-3 6-10 6 5 6 12 0-2 8-13 5" fill="#171d23"/></g>
${text(100,166,'bang',27,inner,'font-weight="bold" letter-spacing="-1" stroke="#1b2938" stroke-width=".8" paint-order="stroke"')}${text(100,178,'ENERGY',8,c,'font-weight="bold" letter-spacing="1"')}${text(100,190,'RAINBOW',7.8,pink,'font-weight="bold"')}${text(100,199,'UNICORN',7.8,pink,'font-weight="bold"')}
<circle cx="132" cy="211" r="6" fill="${inner}" stroke="${yellow}" stroke-width="1.3"/>${text(132,213.6,'0',7,'#fffdf5','font-weight="bold"')}${text(98,219.4,'16 FL OZ (473 mL)',3.6,'#566064')}`;
  return {slug,family:'bang-energy-can',
    packageChoice:'Current US 16 fl oz / 473 mL Bang Energy Rainbow Unicorn can as shown on the manufacturer product page: the white-bodied "FUEL YOUR DESTINY" design shared by the current Blue Razz, Peach Mango and Star Blast cans. The earlier all-blue and pink VPX-era can ("SUPER CREATINE" neck) that the rejected icon cited is the previous package and was not drawn.',
    references:[{pageUrl:'https://www.bangenergy.com/en-us/products/rainbow-unicorn/',imageUrl:'https://web-assests.monsterenergy.com/mnst/43cbe86b-521a-4553-a776-d87bdf03dcdb.png',inspectedAt:date,visuallyInspected:true,
      observations:'Manufacturer front packshot (hero image of the Rainbow Unicorn product page, read through the 2025-08-15 Wayback Machine capture because the live site refuses scripted requests; the image itself was downloaded from the live asset host on 2026-11-15). White/silver 16 fl oz can; teal neck band with white italic FUEL YOUR DESTINY! and a thin pink stripe under it; large lowercase target b with teal outer outline, black inner outline, white face and a yellow offset edge, pink centre disc with the black head motif and black cross-hairs; pink outlined bang wordmark, teal ENERGY, pink stacked RAINBOW UNICORN; teal sweeps with a pink pinstripe rising from both foot corners; pink 0 CALORIES disc with a yellow ring at lower right; grey NATURAL FLAVORS and 16 fl oz (1 PT) 473 mL at the foot.'},
      {pageUrl:'https://www.heb.com/product-detail/bang-energy-drink-rainbow-unicorn/2447502',imageUrl:'https://www.citrolava.com/cdn/shop/files/bang_-_rainbow_-_2.jpg?v=1719193275&width=1946',inspectedAt:date,visuallyInspected:true,
      observations:'The reference recorded by the rejected batch, inspected for comparison only: the earlier Rainbow Unicorn can with a cyan-blue body, pink SUPER CREATINE neck, pink foot section and yellow flavor name. It is the pre-redesign package and differs from the manufacturer\'s current can, so it was not used for the drawing.'}],
    uncertainty:'Catalog has no package size or package generation. The current manufacturer can was drawn; if the catalog row is meant as the older blue and pink can, this is the wrong generation and needs a separate drawing. Target mark, wordmark (Arial Bold standing in for the custom bang lettering) and layout deliberately reuse the geometry of the Good Bang icons; the cross-hair cut through the wordmark, registered marks, CALORIES and NATURAL FLAVORS microcopy are omitted. Live product page could not be fetched directly (HTTP 403 to scripted clients).',
    status:'needs-review',svg:can(slug,'Bang Energy Rainbow Unicorn',label,{color:ref('metal'),defs:`<clipPath id="__ID__bclip"><path d="${b}"/></clipPath>`})};
}

// ───────────────────────── Celsius Cucumber Lime ─────────────────────────
function cucumberSlice(x,y,r){
  const lobes=[-90,30,150].map(a=>`<g transform="rotate(${a})"><path d="M2 0C3.4-3.3 6.4-4.9 8.3-3.9 9.8-2.5 9.8 2.5 8.3 3.9 6.4 4.9 3.4 3.3 2 0Z" fill="#c8e088"/><path d="${[-25,-8.5,8.5,25].map(t=>`M${pol(4.5,t)}L${pol(7.7,t)}`).join('')}" stroke="#f5fbda" stroke-width="1.35" stroke-linecap="round"/><path d="${[-25,-8.5,8.5,25].map(t=>`M${pol(5.2,t)}L${pol(7.2,t)}`).join('')}" stroke="#d6e99b" stroke-width=".35" stroke-linecap="round"/></g>`).join('');
  const bumps=Array.from({length:11},(_,i)=>`<circle cx="${n(13.9*Math.cos((i*33+12)*Math.PI/180))}" cy="${n(13.9*Math.sin((i*33+12)*Math.PI/180))}" r=".62" fill="#2f6d27"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${n(r/14)})">${bumps}<circle r="14" fill="#3a7c2b"/><circle r="13.25" fill="${ref('cuke')}"/><circle r="10.6" fill="none" stroke="#fbfde0" stroke-width="1.1" opacity=".55"/>${lobes}<path d="M0 0 ${pol(4.2,90)}M0 0 ${pol(4.2,210)}M0 0 ${pol(4.2,330)}" stroke="#f4fbd3" stroke-width=".8" stroke-linecap="round"/><path d="M${pol(11.9,198)}A11.9 11.9 0 0 1 ${pol(11.9,262)}" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7"/></g>`;
}
function limeWedge(x,y,s){
  const rays=[[-9.6,1.5],[-8.6,5.2],[-6.2,7.9],[-3,9.5],[.6,10],[4,9.4],[7,7.9],[9.6,5.7],[11.3,3.4]].map(([px,py])=>`M0-3.6 ${px} ${py}`).join('');
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12.6-9.6C-16.5 1-12.5 12.6 1.5 12.8 9.5 12.8 15 7.6 15.4.6Z" fill="${ref('rind')}"/><path d="M-12.2-9C-15 0-11.4 10.6 1.2 10.9 8 10.9 12.6 7 13.6 1.2Z" fill="#eef8c6"/><path d="M-11.4-7.6C-13.3.3-10 9 1 9.4 6.6 9.4 10.6 6.4 11.7 2Z" fill="${ref('limeflesh')}"/><g clip-path="${ref('limeclip')}"><path d="${rays}" stroke="#e6f5b6" stroke-width=".5" fill="none"/><path d="M-11.4-7.6 11.7 2" stroke="#f3fbd6" stroke-width="1.5"/></g><path d="M-10.5 5.5Q-5.5 11.7 2.5 11.9" fill="none" stroke="#c9ea8a" stroke-width=".7" stroke-linecap="round" opacity=".8"/></g>`;
}
const fizz=(x,y,r)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#9fa9a3" stroke-width=".45"/><path d="M${n(x-r*.5)} ${n(y+r*.1)}A${n(r*.5)} ${n(r*.5)} 0 0 1 ${n(x+r*.1)} ${n(y-r*.5)}" fill="none" stroke="#c5ccc7" stroke-width=".35"/>`;
function celsiusCucumberLime(){
  const slug='celsius-cucumber-lime',green='#78b63f',deep='#1f6b3a';
  const badge=(x,inner)=>`<rect x="${x}" y="211.6" width="7.6" height="8.8" rx="1.5" fill="#fbfcf6" stroke="${green}" stroke-width=".55"/>${inner}`;
  const ring=(x,inner)=>`<circle cx="${x}" cy="216" r="4.3" fill="#fbfcf6" stroke="${green}" stroke-width=".55"/><g transform="translate(${x} 216)" fill="none" stroke="${green}" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
  const label=`${text(100,39,'NO SUGAR • NO PRESERVATIVES',3.3,deep,'font-weight="bold" textLength="50" lengthAdjust="spacingAndGlyphs"')}
<g transform="translate(101 78)"><path d="M15-20H-2C-32-20-34 20-4 22 2 23 9 21 14 17L7 10C3 13-7 13-10 7-19-7-3-11 4-11 11-11 15-15 15-20Z" fill="${ref('C')}"/><path d="M-29 .3C-24-3.5-19-6-14.2-7.6-9-9.4-3-10.6 4.4-10.9H20V-25H-35Z" fill="${ref('swoosh')}" clip-path="${ref('Cclip')}"/><circle cx="-25" cy="-15" r="4.2" fill="none" stroke="#8a8e89" stroke-width="2.1"/></g>
${text(100,119,'CELSIUS',13.7,'#202622','font-weight="bold" textLength="53" lengthAdjust="spacingAndGlyphs"')}${text(117,126,'LIVE FIT',4.4,green,'font-weight="bold"')}
<ellipse cx="97" cy="162.6" rx="24" ry="1.5" fill="#56634c" opacity=".2"/>${cucumberSlice(105.5,146.6,15)}${limeWedge(84.6,152.2,.95)}
${fizz(79.5,135.5,1.5)}${fizz(84.2,131.2,.9)}${fizz(88.6,134.2,1.1)}${fizz(82.6,128.6,.6)}${fizz(97.5,128.8,.8)}${fizz(124.6,155.5,.9)}${fizz(126.6,160.4,1)}${fizz(121.4,163.2,1.3)}
${text(99,174.6,'SPARKLING',7.5,'#252b26')}${text(96.5,181.2,'CUCUMBER LIME',4.5,green,'font-weight="bold" textLength="35" lengthAdjust="spacingAndGlyphs"')}
<path d="M66 185.4q3.5.6 7 .9v22.6q-3.5-.3-7-.9Z" fill="${ref('metal')}"/><path d="M74.2 186.4q29.9 3.2 59.8-1v22.6q-29.9 4.2-59.8 1Z" fill="${green}"/>
<path d="M76.6 190.1l1.5 1-1.5 1ZM76.6 194.5l1.5 1-1.5 1Z" fill="#fbfcf3"/><path d="M76.6 199.5l1.5 1-1.5 1ZM76.6 203.9l1.5 1-1.5 1Z" fill="#1f3d1c"/>
${ltext(79.2,192.2,'ESSENTIAL ENERGY',3.3,'#fbfcf3')}${ltext(79.2,196.6,'NATURAL CAFFEINE',3.3,'#fbfcf3')}${ltext(79.2,201.6,'ACCELERATES METABOLISM',3.3,'#fbfcf3')}${ltext(79.2,206,'BURNS BODY FAT',3.3,'#fbfcf3')}
<path d="M66 209.9q34 4.8 68 0V236H66Z" fill="${ref('metal')}" opacity=".85"/><path d="M66 209.9q34 4.8 68 0" fill="none" stroke="#fff" stroke-width=".8" opacity=".8"/>
${badge(72.6,`${text(76.4,217.3,'0',5.6,green,'font-weight="bold"')}${text(76.4,219.5,'SUGAR',1.75,green,'font-weight="bold"')}`)}${badge(81.8,`${text(85.6,215.6,'NON',2.9,green,'font-weight="bold"')}${text(85.6,218.9,'GMO',2.9,green,'font-weight="bold"')}`)}
${ring(96.2,`<circle cx=".5" cy="-2.2" r=".55" fill="${green}" stroke="none"/><path d="M-1.9-.7 0-1.3 1.2-.3 2.2-.9M0-1.3-.5.7 1 1.4.7 2.8M-.5.7-1.5 1.4-2.4 1.3"/>`)}${ring(105.2,`<circle cx="-1.5" cy=".9" r="1.15"/><circle cx="1.6" cy=".9" r="1.15"/><circle cx=".3" cy="-2.3" r=".5" fill="${green}" stroke="none"/><path d="M-1.5.9-.2-.9 1.6.9M-.2-.9.8-1.4"/>`)}${ring(114.2,`<circle cx="0" cy="-2.3" r=".55" fill="${green}" stroke="none"/><path d="M0-1.5C-1.3-.9-1.3.7-.7 1.2H.7C1.3.7 1.3-.9 0-1.5ZM-2.3 1.6Q0 2.7 2.3 1.6"/>`)}
${text(108,226,'12 FL OZ (355 mL)',2.9,'#39423c')}`;
  const defs=`${whiteCan}<linearGradient id="__ID__C" x1="0" y1="0" x2="1" y2="1"><stop offset=".3" stop-color="#c6c9c1"/><stop offset="1" stop-color="#777d76"/></linearGradient><linearGradient id="__ID__swoosh" gradientUnits="userSpaceOnUse" x1="-27" y1="0" x2="15" y2="0"><stop stop-color="#d2de4c"/><stop offset=".38" stop-color="#b3d344"/><stop offset=".72" stop-color="#76b942"/><stop offset="1" stop-color="#66b03e"/></linearGradient><clipPath id="__ID__Cclip"><path d="M15-20H-2C-32-20-34 20-4 22 2 23 9 21 14 17L7 10C3 13-7 13-10 7-19-7-3-11 4-11 11-11 15-15 15-20Z"/></clipPath><radialGradient id="__ID__cuke"><stop offset=".5" stop-color="#f4fbcb"/><stop offset=".8" stop-color="#e3f3ab"/><stop offset="1" stop-color="#b7d874"/></radialGradient><linearGradient id="__ID__rind" x1=".1" y1="0" x2=".7" y2="1"><stop stop-color="#84bd46"/><stop offset="1" stop-color="#3f8129"/></linearGradient><linearGradient id="__ID__limeflesh" x1=".2" y1="0" x2=".5" y2="1"><stop stop-color="#c4e377"/><stop offset="1" stop-color="#8cc447"/></linearGradient><clipPath id="__ID__limeclip"><path d="M-11.4-7.6C-13.3.3-10 9 1 9.4 6.6 9.4 10.6 6.4 11.7 2Z"/></clipPath>`;
  return {slug,family:'celsius-slim-can',
    packageChoice:'US 12 fl oz / 355 mL Celsius Sparkling Cucumber Lime slim can. Cucumber Lime was only sold in the stevia-sweetened Celsius line (launched as the natural-channel extension), so the catalog\'s plain "Celsius Cucumber Lime" is this can: white body, NO SUGAR • NO PRESERVATIVES at the shoulder, lime-green claims panel. No separate standard-line Cucumber Lime can was found. The flavor is absent from celsius.com/products (checked 2026-11-15); this is its last retail package.',
    references:[{pageUrl:'https://www.shipt.com/up/celsius-stevia-sparkling-cucumber-lime-functional-essential-energy-drink-12-fl-oz-single-can/ddd36b82-0d0a-f3a4-56cb-b35d2ee7ab1e',imageUrl:'https://dsom-imager-prod.shipt.com/ddd36b82-0d0a-f3a4-56cb-b35d2ee7ab1e/543791c5-dbcd-4c55-ba4e-2ff2b5b07759.jpeg',inspectedAt:date,visuallyInspected:true,
      observations:'Retailer straight-on front packshot of the single 12 fl oz can: white slim can with silver neck and foot, dark-green NO SUGAR • NO PRESERVATIVES at the shoulder, silver C whose whole upper arm is a yellow-green to green swoosh, grey degree ring, black CELSIUS, green LIVE FIT. Halftone illustration of a cucumber slice (dark skin with small bumps, pale flesh, three seed chambers) with a lime wedge in front at its left and loose bubbles; thin SPARKLING over green CUCUMBER LIME; lime-green claims panel with four white lines and a silver block at its left; silver foot with 0 SUGAR and NON GMO badges and three round activity icons, then CLINICALLY PROVEN / DIETARY SUPPLEMENT and 12 FL OZ (355 mL).'},
      {pageUrl:'https://www.energydrinkmania.net/en/celsius/celsius_sparkling_cucumber_lime.html',imageUrl:'https://www.energydrinkmania.net/celsius/celsius_sparkling_cucumber_lime001.jpg',inspectedAt:date,visuallyInspected:true,
      observations:'Reviewer\'s photograph of a purchased can, used to confirm the packshot against a real can: same layout and colors; on this later printing the first panel line reads ESSENTIAL ENERGY (the retailer render reads HEALTHY ENERGY). The review states the flavor belonged to the stevia-sweetened natural series and left the manufacturer site by 2024.'}],
    uncertainty:'Catalog has no package size or line; drawn as the stevia-line can because no other Cucumber Lime can was found. First panel line follows the later photographed printing (ESSENTIAL ENERGY) rather than the retailer render (HEALTHY ENERGY). The C keeps the outline of the Good Celsius icons with the swoosh as a gradient, not a separate leaf shape. The halftone fruit is redrawn as flat-shaded vectors; CLINICALLY PROVEN / DIETARY SUPPLEMENT is omitted, and the foot is compressed because the house can has less room below the panel than the photographed can. Discontinued flavor: current availability not confirmed.',
    status:'needs-review',svg:can(slug,'Celsius Sparkling Cucumber Lime',label,{narrow:true,color:ref('white'),defs})};
}

export const records=[alaniMimosa(),bangRainbowUnicorn(),celsiusCucumberLime()];
