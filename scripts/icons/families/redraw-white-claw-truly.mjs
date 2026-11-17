// Redraws of five hard-seltzer icons marked "Needs work" in the 2026-11-15 review.
// The rejected recipes for these slugs were in refreshments-12.mjs; nothing here starts
// from that template. Each can is drawn from its manufacturer packshot: the White Claw
// wave emblem and the Truly wordmark are hand-built paths, measured off the references.
import {wrap,shadow,ref,text} from '../style.mjs';

const f=v=>String(Math.round(v*100)/100);
const f1=v=>String(Math.round(v*10)/10);
const date='2026-11-15';

// ---------------------------------------------------------------------------------
// 12 fl oz slim can. House rendering copied from can() in energy-expansion.mjs (lid,
// tab, shade, highlight, bottom rim). Width 72 instead of that helper's 66 ("narrow"):
// both packshots measure about 0.355 wide to tall, and 72 is the closest fit that
// still reads as the same can as the Good slim cans.
// ---------------------------------------------------------------------------------
const L=64,R=136,T=26,RX=100-L-6;
const BODY=`M${L+6} ${T}Q100 ${T-8} ${R-6} ${T}L${R} ${T+16}V220Q${R} 233 100 233T${L} 220V${T+16}Z`;
function slimCan(slug,title,label,{base,defs='',tab='#e6e8de',tabShade='#8d9892',sheen=.17}={}){
  return wrap(slug,title,`${shadow(52)}<path d="${BODY}" fill="${base}"/>
<g clip-path="${ref('bodyclip')}"><path d="M${L+8} ${T+22}V214" fill="none" stroke="#fff" stroke-opacity="${sheen}" stroke-width="2.8"/>
${Array.from({length:25},(_,i)=>`<ellipse cx="${L+9+i*19%(R-L-16)}" cy="${T+21+i*37%163}" rx="${i%4?.5:.9}" ry="${i%4?.8:1.4}" fill="#fff" opacity=".2"/>`).join('')}
${label}<path d="${BODY}" fill="${ref('shade')}" opacity=".8"/></g>
<ellipse cx="100" cy="${T}" rx="${RX}" ry="7" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="${T}" rx="${RX-4}" ry="4.6" fill="none" stroke="#8d9892" stroke-width=".7"/>
<ellipse cx="104" cy="${T+1}" rx="7" ry="2.8" fill="#657169"/>
<path d="M94 ${T-1.4}h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="${tabShade}" stroke-width="2.6"/>
<path d="M94 ${T-2}h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="${tab}" stroke-width="2.2"/>
<path d="M${L+3} 226q${(R-L-6)/2} 12 ${R-L-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M${L+6} 230q${(R-L-12)/2} 7 ${R-L-12} 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
`<clipPath id="__ID__bodyclip"><path d="${BODY}"/></clipPath>${defs}`);
}

// ---------------------------------------------------------------------------------
// A small geometric caps alphabet for the White Claw lettering (a heavy, wide,
// near-monoline sans). Unit box: baseline y=0, cap height 1 (y=-1), stroke TH.
// Straight strokes are polygons with horizontal terminals; bowls are stroked arcs.
// ---------------------------------------------------------------------------------
const TH=.25;
const area=p=>p.reduce((s,[x,y],i)=>{const[q,r]=p[(i+1)%p.length];return s+x*r-q*y},0);
const poly=p=>{const q=area(p)<0?[...p].reverse():p;return 'M'+q.map(([x,y])=>f(x)+' '+f(y)).join('L')+'Z'};
const bar=(x0,y0,x1,y1,t=TH)=>{const dx=x1-x0,dy=y1-y0,hw=t/2*Math.hypot(dx,dy)/Math.abs(dy);return [[x0-hw,y0],[x0+hw,y0],[x1+hw,y1],[x1-hw,y1]]};
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const stem=x=>rect(x,-1,TH,1);
const G={
  W:{w:1.3,p:[bar(.12,-1,.39,0),bar(.39,0,.65,-1),bar(.65,-1,.91,0),bar(.91,0,1.18,-1)]},
  H:{w:.8,p:[stem(0),stem(.8-TH),rect(0,-.5-TH/2,.8,TH)]},
  I:{w:TH,p:[stem(0)]},
  T:{w:.76,p:[rect(0,-1,.76,TH),stem(.38-TH/2)]},
  E:{w:.62,p:[stem(0),rect(0,-1,.62,TH),rect(0,-.5-TH/2,.55,TH),rect(0,-TH,.62,TH)]},
  L:{w:.6,p:[stem(0),rect(0,-TH,.6,TH)]},
  A:{w:1,p:[bar(.5,-1,.11,0),bar(.5,-1,.89,0),rect(.25,-.37,.5,TH*.9)]},
  Z:{w:.74,p:[rect(0,-1,.74,TH),rect(0,-TH,.74,TH),[[.42,-1+TH],[.74,-1+TH],[.32,-TH],[0,-TH]]]},
  M:{w:1.12,p:[bar(.12,0,.22,-1),bar(.22,-1,.56,0,TH*.95),bar(.56,0,.9,-1,TH*.95),bar(.9,-1,1,0)]},
  N:{w:.86,p:[stem(0),stem(.86-TH),[[0,-1],[TH+.05,-1],[.86,0],[.86-TH-.05,0]]]},
  K:{w:.8,p:[stem(0),bar(.17,-.4,.64,-1),bar(.32,-.6,.67,0)]},
  Y:{w:.9,p:[bar(.13,-1,.45,-.44),bar(.77,-1,.45,-.44),rect(.45-TH/2,-.5,TH,.5)]},
  C:{w:.9,s:'M.79 -.76A.39 .39 0 1 0 .79 -.24'},
  G:{w:.96,s:'M.79 -.76A.39 .39 0 1 0 .89 -.45H.54'},
  O:{w:1,s:'M.5 -.89A.39 .39 0 1 0 .5 -.11A.39 .39 0 1 0 .5 -.89Z'},
  D:{w:.86,s:'M.11 -.89H.36A.39 .39 0 0 1 .36 -.11H.11Z'},
  R:{w:.76,p:[stem(0),bar(.43,-.47,.63,0)],s:'M.11 -.89H.43A.2 .2 0 0 1 .43 -.49H.11'},
  B:{w:.74,p:[stem(0)],s:'M.11 -.89H.4A.19 .19 0 0 1 .4 -.51H.11M.11 -.51H.43A.2 .2 0 0 1 .43 -.11H.11'},
  U:{w:.82,s:'M.11 -1V-.41A.3 .3 0 0 0 .71 -.41V-1'},
  S:{w:.68,s:'M.58 -.75C.5 -.93 .11 -.95 .11 -.71C.11 -.5 .58 -.53 .58 -.28C.58 -.04 .15 -.06 .08 -.27'},
};
const glyph=(ch,ink)=>{const g=G[ch];return (g.p?`<path d="${g.p.map(poly).join('')}"/>`:'')+(g.s?`<path d="${g.s}" fill="none" stroke="${ink}" stroke-width="${TH}" stroke-linejoin="miter"/>`:'')};
// Letters set around a circle. Angles are screen degrees (0 = east, 90 = south).
// outward=true: cap tops point away from the centre and the text runs clockwise;
// outward=false: cap tops point at the centre and the text runs anticlockwise.
function arcText(str,cx,cy,rb,cap,a0,a1,ink,{outward=true,wordGap=.45,wide=1.14}={}){
  const chars=[...str],letters=chars.filter(c=>c!==' ');
  const span=Math.abs(a1-a0)*Math.PI/180*rb/cap;
  const gap=(span-letters.reduce((s,c)=>s+G[c].w*wide,0)-(chars.length-letters.length)*wordGap)/(letters.length-1);
  let pos=0,out='';const dir=a1>a0?1:-1;
  for(const c of chars){
    if(c===' '){pos+=wordGap;continue;}
    const a=a0+dir*(pos+G[c].w*wide/2)*cap/rb*180/Math.PI,rad=a*Math.PI/180;
    out+=`<g transform="translate(${f(cx+rb*Math.cos(rad))} ${f(cy+rb*Math.sin(rad))}) rotate(${f(a+(outward?90:-90))}) scale(${f(cap*wide)} ${f(cap)}) translate(${f(-G[c].w/2)} 0)">${glyph(c,ink)}</g>`;
    pos+=G[c].w*wide+gap;
  }
  return `<g fill="${ink}">${out}</g>`;
}
function lineText(str,cx,y,cap,ink,{gap=.13,wordGap=.42}={}){
  const chars=[...str];let w=0;chars.forEach((c,i)=>{w+=c===' '?wordGap:G[c].w+(i<chars.length-1&&chars[i+1]!==' '?gap:0)});
  let x=cx-w*cap/2,out='';
  chars.forEach((c,i)=>{if(c===' '){x+=wordGap*cap;return;}out+=`<g transform="translate(${f(x)} ${f(y)}) scale(${f(cap)})">${glyph(c,ink)}</g>`;x+=(G[c].w+(i<chars.length-1&&chars[i+1]!==' '?gap:0))*cap;});
  return `<g fill="${ink}">${out}</g>`;
}

// ---------------------------------------------------------------------------------
// Tapered brush strokes (the engraved line work of the wave): a Catmull-Rom spline
// through the given points, drawn as a filled lens that swells to `w` at fraction `a`.
// ---------------------------------------------------------------------------------
function spline(pts,per=5){
  const out=[];
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(i-1,0)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(i+2,pts.length-1)];
    for(let j=0;j<per;j++){const t=j/per,t2=t*t,t3=t2*t;
      out.push([0,1].map(k=>.5*(2*p1[k]+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3)));}
  }
  out.push(pts[pts.length-1]);return out;
}
function taper(pts,w,a=.5,min=0,fmt=f1){
  const c=spline(pts),N=c.length-1,g=Math.log(.5)/Math.log(a),left=[],right=[];
  c.forEach((p,i)=>{
    const q0=c[Math.max(i-1,0)],q1=c[Math.min(i+1,N)];let tx=q1[0]-q0[0],ty=q1[1]-q0[1];const l=Math.hypot(tx,ty)||1;tx/=l;ty/=l;
    const h=Math.max(min,w*Math.sin(Math.PI*Math.pow(i/N,g)))/2;
    left.push([p[0]-ty*h,p[1]+tx*h]);right.push([p[0]+ty*h,p[1]-tx*h]);
  });
  return 'M'+[...left,...right.reverse()].map(p=>fmt(p[0])+' '+fmt(p[1])).join('L')+'Z';
}

// ---------------------------------------------------------------------------------
// The White Claw emblem. Coordinates below were read off a 5x enlargement of the
// emblem on the manufacturer packshot (grid px); gl() converts them to emblem-local
// units in which the outer ring has radius 163 and the centre is the origin.
// ---------------------------------------------------------------------------------
const gl=pts=>pts.map(([x,y])=>[x/5-134,y/5-145]);
const W=(pts,w,a=.5,min=0)=>taper(gl(pts),w*1.85/5,a,min*1.85/5);
const WAVE=[
  // spray line outside the big wave, and the wave's back
  W([[58,786],[50,572],[104,352],[236,198],[414,108],[628,52]],12,.5),
  W([[58,470],[125,335],[250,215],[400,150],[520,126],[650,120]],15,.55),
  // ribs of the big wave, back to front, each running up into the crest
  W([[95,722],[78,560],[112,415],[215,300]],11,.45),
  W([[185,712],[170,525],[228,345],[375,215],[520,152]],13,.4),
  W([[265,712],[258,545],[308,380],[430,250],[560,168],[650,138]],13,.4),
  W([[345,716],[338,560],[378,400],[480,272],[610,182],[705,152]],13,.4),
  W([[435,745],[408,585],[440,420],[530,292],[650,202],[765,168]],14,.4),
  W([[500,732],[468,585],[493,432],[580,307],[700,218],[822,186]],14,.4),
  W([[580,742],[528,602],[538,452],[613,332],[730,247],[852,214]],15,.4),
  // heavy shadow inside the curl
  W([[770,832],[655,742],[578,622],[553,482],[590,372],[668,296]],30,.45),
  // crest: the claw that hooks over, and the foam dripping from the lip
  W([[790,40],[880,72],[948,140],[998,250]],27,.62),
  W([[650,120],[700,160],[738,142],[800,152],[850,180],[878,226]],11,.5,5),
  W([[878,226],[905,205],[955,214],[998,250]],11,.4,4),
  // second wave: claw, scalloped lip, fine ribs, inner shadow
  W([[750,292],[872,300],[978,360],[1030,465]],22,.62),
  W([[600,445],[640,358],[705,340],[790,350],[850,343],[905,372]],10,.5,5),
  W([[905,372],[950,402],[998,408],[1030,465]],10,.4,4),
  W([[690,350],[625,432],[600,532],[628,645]],8.5,.45),
  W([[716,352],[646,437],[621,537],[651,655]],8,.45),
  W([[742,354],[667,442],[642,542],[674,662]],8.5,.45),
  W([[770,357],[695,442],[670,537],[702,645]],8,.45),
  W([[798,360],[722,442],[698,532],[730,625]],8.5,.45),
  W([[866,372],[792,440],[765,505],[778,572]],12,.5),
  // third wave: claw, ribs, and the solid black hollow beneath it
  W([[775,645],[800,575],[870,527],[960,510],[1040,530],[1095,602]],17,.72),
  W([[850,548],[806,622],[800,702],[832,772]],7,.45),
  W([[876,542],[829,622],[823,702],[857,777]],6.5,.45),
  W([[902,537],[852,622],[846,702],[882,782]],7,.45),
  W([[927,537],[877,622],[871,702],[907,785]],6.5,.45),
  W([[952,537],[902,622],[896,702],[932,787]],7,.45),
  W([[977,548],[930,627],[924,707],[960,785]],6.5,.45),
  W([[1002,560],[957,632],[952,712],[987,782]],7,.45),
  W([[905,752],[1030,796],[1170,778],[1287,710]],44,.38),
  // lines sweeping out from under the waves
  W([[650,855],[800,906],[980,916],[1150,872],[1268,770]],11,.5),
  W([[700,800],[850,862],[1020,864],[1182,812]],9,.5),
  // the long swell lines across the foot of the emblem
  W([[72,797],[200,752],[360,762],[520,832],[700,912],[900,972],[1100,952],[1232,872],[1274,800]],16,.5),
  W([[75,872],[200,824],[392,832]],9,.5),
  W([[110,942],[300,893],[500,886],[680,941],[880,1006],[1080,1011],[1212,930]],14,.5),
  W([[160,1021],[350,973],[560,979],[760,1041],[960,1073],[1152,1026]],13,.5),
  W([[240,1091],[450,1063],[650,1083],[850,1129],[1040,1113],[1112,1083]],13,.5),
  W([[370,1166],[560,1151],[760,1181],[940,1183],[1062,1141]],11,.5),
  W([[430,1216],[600,1247],[802,1241]],9,.5),
  // the gull
  W([[1130,275],[1150,340],[1160,385]],7,.6),
  W([[1160,385],[1190,392],[1222,410]],6,.4),
  W([[1085,385],[1100,402],[1114,410]],5,.5),
].join('');
const INK='#141414';
function clawEmblem(cx,cy,r){
  const k=r/163;
  const a=(deg,rad)=>[cx+rad*Math.cos(deg*Math.PI/180),cy+rad*Math.sin(deg*Math.PI/180)];
  const[p0x,p0y]=a(-24,r),[p1x,p1y]=a(158,r);
  return `<g transform="translate(${f(cx)} ${f(cy)}) scale(${f(k)})"><path d="${WAVE}" fill="${INK}"/></g>
<path d="M${f(p0x)} ${f(p0y)}A${f(r)} ${f(r)} 0 1 1 ${f(p1x)} ${f(p1y)}" fill="none" stroke="${INK}" stroke-width="${f(r*.046)}"/>
${arcText('WHITE CLAW',cx,cy,r*.9,r*.238,169,325,INK)}
${arcText('HARD SELTZER',cx,cy,r*.905,r*.19,146,-11,INK,{outward:false})}`;
}

// White Claw label: neck bands, emblem, flavor swash with the name, the 5% badge
// and the two descriptor lines. Everything outside `c` is shared by the three flavors.
const tiny=(x,y,label,size,fill,len,extra='')=>text(x,y,label,size,fill,`font-weight="700" textLength="${len}" lengthAdjust="spacingAndGlyphs" ${extra}`);
function badge(cx,cy){
  const adv={' ':.3,I:.3,L:.62,T:.62,F:.62,'1':.56,'0':.56,O:.78,G:.78};
  const ring=(str,r,a0,a1,out)=>{const cs=[...str],ws=cs.map(c=>adv[c]||.7),tot=ws.reduce((a,b)=>a+b,0)-(ws[0]+ws[ws.length-1])/2;let acc=-ws[0]/2;
    return cs.map((c,i)=>{const mid=acc+ws[i]/2;acc+=ws[i];if(c===' ')return '';const a=a0+(a1-a0)*mid/tot,rad=a*Math.PI/180;return `<text transform="translate(${f(cx+r*Math.cos(rad))} ${f(cy+r*Math.sin(rad))}) rotate(${f(a+(out?90:-90))})" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="3" fill="${INK}">${c}</text>`}).join('')};
  return `<circle cx="${cx}" cy="${cy}" r="12.3" fill="#f6f6f4"/>
<circle cx="${cx}" cy="${cy}" r="8.1" fill="${INK}"/>
${ring('100 CALORIES',8.9,-158,-22,true)}${ring('GLUTEN FREE',10.9,152,28,false)}
${text(cx,cy+.6,'5%',5.4,'#fff','font-weight="700"')}
${tiny(cx,cy+4,'ALC/VOL',2.5,'#fff',7.6)}`;
}
function whiteClaw(c){
  const label=`<path d="M${L} 30.5Q100 42.5 ${R} 30.5" fill="none" stroke="${c.band}" stroke-width="5"/>
<path d="M${L} 39.6Q100 51 ${R} 39.6" fill="none" stroke="${c.band}" stroke-width="1.1"/>
${tiny(100,43.4,'100 CALORIES',2.9,INK,19)}
<circle cx="88" cy="42" r=".55" fill="${c.band}"/><circle cx="112" cy="42" r=".55" fill="${c.band}"/>
${tiny(0,0,'2g CARBS',2.9,INK,13,'transform="translate(121.6 41.5) rotate(-7)"')}
${tiny(0,0,'MADE PURE',2.9,INK,15,'transform="translate(77.6 41.6) rotate(7)" font-style="italic"')}
${clawEmblem(101.2,98,30.5)}
<path d="M${L-2} 165.5C76 158.5 88 154 100 151.6C112 149.3 124 147 ${R+2} 144.5V170C124 171.5 112 172.6 100 175.4C88 178.5 76 183.5 ${L-2} 195Z" fill="${c.streak}"/>
<path d="M${L-2} 164.5C76 157.5 88 153.6 100 151.6C112 149.5 124 147.4 ${R+2} 144.5L${R+2} 165.6C124 167.4 112 169.4 100 172.2C88 175.4 76 181 ${L-2} 190.5Z" fill="${ref('swash')}"/>
<path d="${[taper([[137,165.3],[129,166.6],[118,168.8]],1.5,.14,0,f),taper([[137,168.5],[131,169.3],[123,170.7]],1.1,.14,0,f),taper([[137,147.5],[130,148.8],[121,150.6]],.8,.14,0,f),taper([[137,172.2],[132,172.7],[126,173.6]],.9,.14,0,f),taper([[63,167.6],[70,163.8],[81,159.4]],1,.14,0,f),taper([[63,192.6],[70,188.2],[80,183.6]],.9,.14,0,f)].join('')}" fill="#f5f5f3"/>
<path d="M${L} 187C72 181.5 84 177 97 173.4" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".5"/>
${c.name.length===1?lineText(c.name[0],100,165.7,6.2,INK):lineText(c.name[0],100,163,5.9,INK)+lineText(c.name[1],100,171,5.9,INK)}
${badge(100,185.4)}
${tiny(100,206.2,'SPIKED SPARKLING WATER',3.3,INK,54)}
${tiny(100,210.6,`WITH A HINT OF ${c.name.join(' ')}`,2.75,INK,c.hint)}`;
  return slimCan(c.slug,c.title,label,{base:ref('white'),tab:c.tab,tabShade:c.tabShade,
    defs:`<linearGradient id="__ID__white"><stop stop-color="#c8cbcc"/><stop offset=".24" stop-color="#fcfcfb"/><stop offset=".6" stop-color="#f1f1f0"/><stop offset="1" stop-color="#c4c8c9"/></linearGradient>
<linearGradient id="__ID__swash" gradientUnits="userSpaceOnUse" x1="${L}" y1="0" x2="${R}" y2="0"><stop stop-color="${c.dark}"/><stop offset=".3" stop-color="${c.mid}"/><stop offset=".62" stop-color="${c.hi}"/><stop offset=".82" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>`});
}

const clawFlavors=[
  {slug:'white-claw-black-cherry',title:'White Claw Hard Seltzer Black Cherry',name:['BLACK','CHERRY'],hint:52,
   mid:'#e05389',dark:'#bf2a68',hi:'#ec6b9c',streak:'#c13b75',band:'#c9316f',tab:'#dc5f9f',tabShade:'#a93a76',
   page:'https://www.whiteclaw.com/products/black-cherry',image:'https://www.whiteclaw.com/wp-content/uploads/2025/02/Black-Cherry_383-x-800_1.png?t=1772622575093',
   colorNote:'a magenta-pink swash (#e05389) over a deeper magenta streak (#c13b75), magenta neck band and a pink pull tab'},
  {slug:'white-claw-mango',title:'White Claw Hard Seltzer Mango',name:['MANGO'],hint:42,
   mid:'#f4be51',dark:'#cd861c',hi:'#fad27b',streak:'#f39864',band:'#f29460',tab:'#f5e400',tabShade:'#c9a400',
   page:'https://www.whiteclaw.com/products/mango',image:'https://www.whiteclaw.com/wp-content/uploads/2025/04/Mango_383-x-800_1.png?t=1772622532952',
   colorNote:'a metallic gold swash (#f4be51) over a coral-orange streak (#f39864), coral neck band and a yellow pull tab'},
  {slug:'white-claw-natural-lime',title:'White Claw Hard Seltzer Natural Lime',name:['NATURAL','LIME'],hint:52,
   mid:'#c3d344',dark:'#9aae22',hi:'#cfdc66',streak:'#a4c64a',band:'#abca4d',tab:'#b3cd20',tabShade:'#86a012',
   page:'https://www.whiteclaw.com/products/natural-lime',image:'https://www.whiteclaw.com/wp-content/uploads/2025/05/Natural-Lime_383-x-800_1.png?t=1772622408420',
   colorNote:'a yellow-green swash (#c3d344) over a greener streak (#accc52), green neck band and a lime-green pull tab'},
];

// ---------------------------------------------------------------------------------
// Truly. The wordmark is drawn as outlines (cap height 1, baseline y=0) from the
// packshot: T, R, U, L and a Y kerned over the foot of the L. It runs up the can.
// ---------------------------------------------------------------------------------
const TRULY='M0 -1H.96V-.71H.655V0H.29V-.71H0Z'
 +'M1.03 0V-1H1.66Q1.95 -1 1.95 -.71Q1.95 -.5 1.77 -.43L2 0H1.61L1.43 -.38H1.385V0ZM1.385 -.76H1.57Q1.63 -.76 1.63 -.69T1.57 -.62H1.385Z'
 +'M2.046 -1H2.401V-.41Q2.401 -.28 2.527 -.28T2.653 -.41V-1H3.008V-.38Q3.008 .02 2.527 .02T2.046 -.38Z'
 +'M3.108 -1H3.463V-.29H3.885V0H3.108Z'
 +'M3.69 -1H4.075L4.19 -.66L4.305 -1H4.67L4.385 -.4V0H4.02V-.4Z';
const up=(x,y,label,size,fill,len,extra='')=>text(0,0,label,size,fill,`transform="translate(${x} ${y}) rotate(-90)" font-weight="700" textLength="${len}" lengthAdjust="spacingAndGlyphs" ${extra}`);
function truly(c){
  const cap=23.8,xb=100.9,yb=187.5;
  const label=`${c.art}
<g transform="translate(${xb} ${yb}) rotate(-90) scale(${cap})"><path d="${TRULY}" fill="${ref('word')}" fill-rule="evenodd"/></g>
${up(c.flavorX,c.flavorY,c.flavor,c.flavorSize,c.accent,c.flavorLen,`stroke="${c.accent}" stroke-width=".3"`)}
${up(c.subX,c.subY,'WITH OTHER NATURAL FLAVORS',c.subSize,c.accent,c.subLen)}
${tiny(100,198.4,'HARD SELTZER',7,c.ink,43,`stroke="${c.ink}" stroke-width=".2"`)}
<path d="M97.2 201.8h5.6" stroke="${c.accent}" stroke-width=".55"/>
${text(100,208.1,'5% ALC./VOL.',4.7,c.ink,'textLength="21" lengthAdjust="spacingAndGlyphs"')}
${text(100,215.9,c.legal,3.5,c.ink,`font-weight="700" textLength="${c.legalLen}" lengthAdjust="spacingAndGlyphs"`)}`;
  return slimCan(c.slug,c.title,label,{base:ref('base'),tab:c.tab,tabShade:c.tabShade,sheen:c.sheen,defs:c.defs});
}

// Wild Berry: a blackberry, a strawberry and a raspberry tumbling in under the rim.
// A drupelet fruit: overlapping beads packed on a hex grid inside an ellipse.
const drupes=(cx,cy,rx,ry,d,[fill,edge,glint],rot=0)=>{
  let beads='',glints='';const r=d*.5;
  for(let j=0,y=-ry+d*.5;y<=ry-d*.35;j++,y+=d*.87)for(let x=-rx+(j%2?d*.5:0);x<=rx;x+=d){
    if((x/(rx-d*.32))**2+(y/(ry-d*.32))**2>1)continue;
    beads+=`M${f(x-r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(d)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-d)} 0Z`;
    glints+=`M${f(x-r*.5)} ${f(y-r*.25)}q${f(r*.4)} ${f(-r*.5)} ${f(r*.85)} ${f(-r*.2)}`;}
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})"><ellipse rx="${f(rx-.1)}" ry="${f(ry-.1)}" fill="${edge}"/><path d="${beads}" fill="${fill}" stroke="${edge}" stroke-width=".25"/><path d="${glints}" fill="none" stroke="${glint}" stroke-width=".5" stroke-linecap="round" opacity=".8"/></g>`;
};
const BLACKB=['#33213a','#170e1b','#9a8aa8'],RASPB=['#e63c44','#bf2230','#ffa8a0'];
const seeds=[[85.5,38],[91,36],[97,36.5],[103,38],[108,41],[83.5,44],[88.5,42.5],[94.5,42.5],[100.5,44],[106,46.5],[86.5,49.5],[92,48.5],[98,49.5],[103.5,52],[90,55],[95.5,55],[100.5,57.5],[93.5,60.5],[98,62.5],[96.5,66.5]];
const berryArt=`<ellipse cx="98" cy="62" rx="36" ry="15" fill="${ref('glow')}"/>
<path d="M64 30q7-3.5 15-.5 3.5 6.5-1 12-9 2.5-14-3.5Z" fill="#dc2f37"/><path d="M67 33.4q5-1.8 10 .4" fill="none" stroke="#ff938c" stroke-width=".8" stroke-linecap="round" opacity=".7"/>
${drupes(113,35.5,10,7,3.3,BLACKB,-8)}
${drupes(129,39.5,8.5,8,3,RASPB,10)}
<path d="M79 34.5C78.6 28.6 89.5 27.6 96 30C102.5 27.8 112.4 29.6 111.8 37.5C111 47.5 105.6 59.6 99.6 68.6C98.6 70.4 96.9 70.4 95.8 68.7C88.6 59 79.6 45.6 79 34.5Z" fill="${ref('straw')}"/>
<path d="M83 34.6C88 31.6 99 31.4 105.5 34.4" fill="none" stroke="#ffa39b" stroke-width="1.7" stroke-linecap="round" opacity=".5"/>
<path d="M82.6 39.5C84.4 49 89.8 58.4 96 65.6" fill="none" stroke="#ffb9b0" stroke-width="1.2" stroke-linecap="round" opacity=".38"/>
<path d="M109.6 40C108 50 103.6 59.6 98.6 67.4" fill="none" stroke="#9c1220" stroke-width="1.6" stroke-linecap="round" opacity=".28"/>
${seeds.map(([x,y],i)=>`<ellipse cx="${x}" cy="${y}" rx=".62" ry="1" fill="#f8d55c" stroke="#b81a22" stroke-width=".28" transform="rotate(${(i%5-2)*9} ${x} ${y})"/>`).join('')}
${drupes(76,54.5,8.2,12.8,3.5,BLACKB,-6)}
${drupes(118,52.5,10.4,11.8,3.2,RASPB,8)}
${[[110,69,.5],[114,72,.4],[121,68,.55],[125,71.5,.35],[129,65,.45],[106,73,.35],[87,71,.4],[118,75,.3],[131,70,.3],[102,76,.25]].map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="#e0354a" opacity=".75"/>`).join('')}`;
// Original Lemonade: a lemon wheel hanging under the rim with a second slice behind
// it, and a spray of juice specks falling onto the black can.
const lemonArt=`<ellipse cx="110" cy="30" rx="25.5" ry="29" fill="#f29a2a"/><ellipse cx="110" cy="30" rx="23.2" ry="26.6" fill="#fbf4dc"/><ellipse cx="110" cy="30" rx="21.6" ry="25" fill="#f6d43a"/>
<path d="M118 34L130 45M119 37L126 52" stroke="#fdf3b4" stroke-width=".8" stroke-linecap="round" opacity=".7"/>
<ellipse cx="97" cy="31" rx="29.5" ry="38.6" fill="${ref('rind')}"/>
<path d="M70 47C74 58 84 67 97 68.6" fill="none" stroke="#ffd368" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>
<ellipse cx="96" cy="32" rx="27.4" ry="32.2" fill="#fdfaf0"/>
<ellipse cx="96" cy="32" rx="25.3" ry="29.8" fill="${ref('flesh')}"/>
${[14,40,66,92,118,144,168].map(a=>{const r=a*Math.PI/180;return `<path d="M96 32L${f(96+25.3*Math.cos(r))} ${f(32+29.8*Math.sin(r))}" stroke="#fffbe2" stroke-width="1.15" opacity=".92"/>`}).join('')}
${[27,53,79,105,131,156].map((a,i)=>{const r=a*Math.PI/180;return `<path d="M${f(96+8*Math.cos(r))} ${f(32+9*Math.sin(r))}L${f(96+(17+i%2*4)*Math.cos(r))} ${f(32+(20+i%2*4)*Math.sin(r))}" stroke="#fff8ac" stroke-width=".7" stroke-linecap="round" opacity=".75"/>`}).join('')}
<circle cx="96" cy="32" r="2.6" fill="#fffbe2"/>
${Array.from({length:74},(_,i)=>{const u=(i*7919%101)/100,v=(i*104729%89)/88,w=(i*31%17)/16;const x=66+u*68,y=32.5+38.6*Math.sqrt(Math.max(.02,1-((x-97)/31)**2))+v*v*24;return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(.18+w*w*.5)}" fill="${i%5?'#f8d838':'#ffe96a'}" opacity="${f(.95-v*.5)}"/>`}).join('')}`;
const trulyLegal='CONTAINS ALCOHOL | 12 FL. OZ. (355 mL.) | CONTAINS ALCOHOL';
const trulyFlavors=[
  {slug:'truly-wild-berry',title:'Truly Hard Seltzer Wild Berry',flavor:'WILD BERRY',accent:'#e11f45',ink:'#232021',
   flavorX:115.2,flavorY:132.2,flavorSize:12.15,flavorLen:76,subX:122.2,subY:132.6,subSize:5.6,subLen:52,
   legal:trulyLegal,legalLen:92,tab:'#3a3b3d',tabShade:'#17181a',sheen:.17,art:berryArt,
   defs:`<linearGradient id="__ID__base"><stop stop-color="#b4b9bc"/><stop offset=".22" stop-color="#fbfbfa"/><stop offset=".6" stop-color="#eeefef"/><stop offset="1" stop-color="#b0b6b9"/></linearGradient>
<linearGradient id="__ID__word" gradientUnits="userSpaceOnUse" x1="0" y1="-1" x2="0" y2="0"><stop stop-color="#7d8389"/><stop offset=".2" stop-color="#4b4d51"/><stop offset=".36" stop-color="#232021"/></linearGradient>
<radialGradient id="__ID__glow"><stop stop-color="#ef8f97" stop-opacity=".6"/><stop offset="1" stop-color="#ef8f97" stop-opacity="0"/></radialGradient>
<linearGradient id="__ID__straw" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4514a"/><stop offset=".5" stop-color="#e72f33"/><stop offset="1" stop-color="#bd1a26"/></linearGradient>`,
   page:'https://www.trulyhardseltzer.com/flavors/light-flavor/wild-berry',
   image:'https://edge.sitecorecloud.io/bostonbeerc916d-bostonbeerda77-prod8a10-c798/media/project/boston-beer/truly-hard-seltzer/products/product-detail-page/wild-berry-can-lg.png'},
  {slug:'truly-lemonade',title:'Truly Hard Seltzer Original Lemonade',flavor:'ORIGINAL LEMONADE',accent:'#f6e531',ink:'#fbfbfa',
   flavorX:112.6,flavorY:130.7,flavorSize:8.3,flavorLen:86,subX:118.4,subY:131,subSize:4.7,subLen:43,
   legal:'CONTAINS ALCOHOL | 12 FL. OZ. (355 mL.) | CONTAINS <1% JUICE',legalLen:92,tab:'#3a3b3d',tabShade:'#17181a',sheen:.1,art:lemonArt,
   defs:`<linearGradient id="__ID__base"><stop stop-color="#0d0d0e"/><stop offset=".2" stop-color="#3a3a3d"/><stop offset=".34" stop-color="#1d1d1f"/><stop offset=".7" stop-color="#151516"/><stop offset=".9" stop-color="#2c2c2e"/><stop offset="1" stop-color="#0d0d0e"/></linearGradient>
<linearGradient id="__ID__word" gradientUnits="userSpaceOnUse" x1="0" y1="-1" x2="0" y2="0"><stop stop-color="#b9bcbf"/><stop offset=".22" stop-color="#e9eaea"/><stop offset=".4" stop-color="#fdfdfd"/></linearGradient>
<radialGradient id="__ID__flesh" gradientUnits="userSpaceOnUse" cx="96" cy="32" r="29"><stop stop-color="#fff9a6"/><stop offset=".55" stop-color="#fff25c"/><stop offset="1" stop-color="#f7dc34"/></radialGradient>
<linearGradient id="__ID__rind" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffc23c"/><stop offset=".7" stop-color="#fda52f"/><stop offset="1" stop-color="#ee8a22"/></linearGradient>`,
   page:'https://www.trulyhardseltzer.com/flavors/bold-flavor/original-lemonade',
   image:'https://edge.sitecorecloud.io/bostonbeerc916d-bostonbeerda77-prod8a10-c798/media/project/boston-beer/truly-hard-seltzer/products/product-detail-page/original-lemonade-can-lg.png'},
];

const clawRecords=clawFlavors.map(c=>({
  slug:c.slug,family:'white-claw-slim-can',
  packageChoice:`Current US White Claw Hard Seltzer ${c.name.map(w=>w[0]+w.slice(1).toLowerCase()).join(' ')} 12 fl oz (355 mL) slim can, the standard retail single can shown on the manufacturer product page.`,
  references:[{pageUrl:c.page,imageUrl:c.image,inspectedAt:date,visuallyInspected:true,
    observations:`Manufacturer front packshot, 543x1135 transparent PNG; the can measures about 0.356 wide to tall. Matte white slim can. The hero is a round emblem in black line art, about 85% of the can width, centred a third of the way down: WHITE CLAW in heavy geometric caps on an arc over the top (rotated a little anticlockwise), an engraved illustration of three cresting waves with a gull, and a ring around the lower half with HARD SELTZER set inside it. Below it a brushed swash rises to the right across the full width: ${c.colorNote}. The flavor name ${c.name.join(' ')} is set level on the swash in black caps. A black disc reading 5% ALC/VOL, ringed by 100 CALORIES and GLUTEN FREE, sits on the lower edge of the swash, then SPIKED SPARKLING WATER / WITH A HINT OF ${c.name.join(' ')}. The neck has a flavor-colored band, a white band of small black copy (MADE PURE, 100 CALORIES, 2g CARBS) and a thin flavor-colored line.`}],
  uncertainty:'The can body is drawn 72 units wide against 66 for the Good narrow cans, to hold the measured 0.356 proportion. The wave is a hand-drawn simplification of the engraving: about 43 tapered strokes where the original has several times that, same composition. The lettering is a purpose-drawn geometric alphabet matched to the can by eye, not the brand typeface. The emblem is drawn flat, without the foreshortening of the cylinder. The neck copy and badge ring text are set in Arial Bold; the grey line near the base (HARD SELTZER WITH FLAVORS) is omitted; condensation and the vertical ABV/deposit copy at the sides are omitted. Pull-tab color follows the packshot render and may be silver on shelf cans.',
  status:'needs-review',svg:whiteClaw(c),
}));
const trulyNotes={
  'truly-wild-berry':{
    pack:'Current US Truly Hard Seltzer Wild Berry 12 fl oz (355 mL) slim can, standard artwork from the manufacturer product page. The image the rejected batch recorded (Gopuff) is a U.S. Soccer co-branded promotional can and was used only as a straight-on check of the shared layout; its crest, stars, blue halftone and sponsor line are not drawn.',
    obs:'Manufacturer packshot, 281x855 transparent PNG, three-quarter view. White slim can with silver edges. Under the rim a photographic cluster of fruit: a blackberry at the left, a large strawberry in the centre, a raspberry at the right, a second blackberry and red berries behind, over a soft pink glow with fine red specks. TRULY runs up the can in very heavy black grotesque caps about a third of the can width tall, left of centre, with a grey sheen on the cap-top side. WILD BERRY runs up beside it in red (#e5173f) bold caps, then WITH OTHER NATURAL FLAVORS in small red condensed caps. Level at the foot: HARD SELTZER in black, a short red rule, 5% ALC./VOL., and a wrap-around line CONTAINS ALCOHOL | 12 FL. OZ. (355 mL.). Proportions (can 0.351 wide to tall, wordmark from 25% to 78% of the height) were measured on the straight-on Gopuff packshot of the same 12 oz can.',
    unc:'The fruit is a simplified vector cluster after a photograph: positions and kinds match, drupelet counts and lighting do not. WILD BERRY, the small copy and HARD SELTZER are set in Arial Bold, which is lighter and less extended than the brand face; the TRULY wordmark is drawn as outlines from the packshot. The registered mark, condensation and the reflection under the can are omitted. The wrap-around legal line is repeated to fill the width as on the can. The can body is 72 units wide against 66 for the Good narrow cans, to hold the measured proportion.'},
  'truly-lemonade':{
    pack:'Current US Truly Hard Seltzer Original Lemonade 12 fl oz (355 mL) slim can, from the manufacturer product page; the catalog row gives no size, and this replaces the 24 oz H-E-B can the rejected batch drew. The can is black on the manufacturer packshot: the whole Truly Lemonade line ships in black cans, unlike the white core flavors.',
    obs:'Manufacturer packshot, 281x855 transparent PNG, three-quarter view, reading 12 FL. OZ. (355 mL.) on the base line. Gloss black slim can. Under the rim a large lemon slice with pale yellow flesh, a white pith ring and orange-yellow rind, a second slice behind it to the right, and a spray of yellow specks falling onto the black. TRULY runs up the can in very heavy white grotesque caps with a grey sheen on the cap-top side. ORIGINAL LEMONADE runs up beside it in yellow bold caps, smaller than the flavor name on the white cans, then WITH OTHER NATURAL FLAVORS in small yellow condensed caps. Level at the foot: HARD SELTZER in white, a short yellow rule, 5% ALC./VOL., and the line CONTAINS ALCOHOL | 12 FL. OZ. (355 mL.) | CONTAINS <1% JUICE. The H-E-B 24 oz packshot shows the same artwork on a taller can.',
    unc:'The lemon is a simplified vector after a photograph. The straight-on proportions are taken from the Wild Berry 12 oz can, which shares the layout; no straight-on single 12 oz Original Lemonade packshot was found, only the three-quarter manufacturer render. ORIGINAL LEMONADE, the small copy and HARD SELTZER are set in Arial Bold rather than the brand face; the TRULY wordmark is drawn as outlines. The registered mark and condensation are omitted. The can body is 72 units wide against 66 for the Good narrow cans, to hold the measured proportion.'},
};
const trulyRecords=trulyFlavors.map(c=>({
  slug:c.slug,family:'truly-slim-can',packageChoice:trulyNotes[c.slug].pack,
  references:[{pageUrl:c.page,imageUrl:c.image,inspectedAt:date,visuallyInspected:true,observations:trulyNotes[c.slug].obs}],
  uncertainty:trulyNotes[c.slug].unc,status:'needs-review',svg:truly(c),
}));
export const records=[...clawRecords,...trulyRecords];
