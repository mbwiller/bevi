// Redraws of icons marked Needs work in the 2026-11-15 review.
// The rejected recipes for these four slugs lived in refreshments-12.mjs.
// Each can is drawn from its inspected packshot: the High Noon sun disc and
// the Cutwater wordmark and eagle are paths, not typed names.
import {wrap,shadow,ref,text} from '../style.mjs';

const q=v=>+(+v).toFixed(2);
const pts=list=>'M'+list.map(([x,y])=>`${q(x)} ${q(y)}`).join('L')+'Z';

// House can rendering, copied from the Good helpers: the 12 oz slim body of
// energy-expansion.mjs (`narrow`) and the standard 12 oz body of
// beer-cans-expansion.mjs. Same lid, shading, highlight, rim and shadow.
function can(slug,title,label,{slim=false,color='#f4f4f0',defs=''}={}) {
  const l=slim?67:55,r=200-l,t=slim?24:41,rx=100-l-6;
  const body=slim
    ?`M${l+6} ${t}Q100 ${t-8} ${r-6} ${t}L${r} ${t+16}V220Q${r} 233 100 233T${l} 220V${t+16}Z`
    :`M${l+6} ${t}Q100 ${t-9} ${r-6} ${t}L${r} ${t+17}V220Q${r} 233 100 233T${l} 220V${t+17}Z`;
  const lid=slim
    ?`<ellipse cx="100" cy="${t}" rx="${rx}" ry="7" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="${t}" rx="${rx-4}" ry="4.6" fill="none" stroke="#8d9892" stroke-width=".7"/>
<ellipse cx="104" cy="${t+1}" rx="7" ry="2.8" fill="#657169"/>
<path d="M94 ${t-2}h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="#e6e8de" stroke-width="2.2"/>`
    :`<ellipse cx="100" cy="${t}" rx="${rx}" ry="8" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.2"/>
<ellipse cx="100" cy="${t}" rx="${rx-5}" ry="5.5" fill="none" stroke="#8d9892" stroke-width=".8"/>
<ellipse cx="104" cy="${t+1}" rx="8" ry="3.5" fill="#657169"/>
<path d="M93 ${t-2}h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="#e6e8de" stroke-width="2.4"/>`;
  return wrap(slug,title,`${shadow(slim?49:58)}<path d="${body}" fill="${color}"/>
<g clip-path="${ref('bodyclip')}">${label}<path d="${body}" fill="${ref('shade')}" opacity="${slim?.8:.9}"/>
<path d="M${l+(slim?8:10)} ${t+21}V${slim?214:211}" fill="none" stroke="#fff" stroke-opacity="${slim?.17:.2}" stroke-width="${slim?2.8:3}"/></g>
${lid}
<path d="M${l+3} 226q${(r-l-6)/2} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M${l+6} 230q${(r-l-12)/2} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
`<clipPath id="__ID__bodyclip"><path d="${body}"/></clipPath>${defs}`);
}

// Drawn capitals. The cans set their names in heavy geometric and condensed
// grotesques that none of the export fonts resemble, so each letter is built
// from a stroked centreline (stems, bars, bowls) plus filled diagonals.
// F: W letter width, h cap height, sw stroke, rx/ry bowl radii, wf width factors.
const WF={A:1.08,C:.95,D:1,E:.84,G:1,H:1,K:1.04,L:.8,M:1.3,N:1.02,O:1,P:.95,R:1,S:.95,T:.92,U:1,V:1.06,W:1.85,Z:.9};
function glyph(ch,F){
  const {W,h,sw}=F,s=sw/2,dw=F.dw??sw*1.08;
  const w=ch==='I'?sw:W*(F.wf?.[ch]??WF[ch]);
  if(!w)throw Error('No glyph for '+ch);
  const gx=Math.min(F.rx,(w-sw)/2),gy=Math.min(F.ry,(h-sw)/2);
  const L=s,R=w-s,T=s,B=h-s,c=w/2,S=[],P=[];
  const a=(x,y,sweep,ax=gx,ay=gy)=>`A${q(ax)} ${q(ay)} 0 0 ${sweep} ${q(x)} ${q(y)}`;
  const poly=list=>P.push(pts(list));
  // Where a C or G arm ends: on the straight side, or on the corner arc of a round bowl.
  const arm=(y,top)=>{
    const edge=top?T+gy:B-gy;
    if(top?y>=edge:y<=edge)return {x:R,y,straight:true};
    const sin=Math.min(1,Math.abs(edge-y)/gy);
    return {x:R-gx+gx*Math.sqrt(1-sin*sin),y,straight:false};
  };
  switch(ch){
    case 'I':S.push(`M${q(s)} 0V${q(h)}`);break;
    case 'L':S.push(`M${q(L)} 0V${q(B)}H${q(w)}`);break;
    case 'E':S.push(`M${q(w)} ${q(T)}H${q(L)}V${q(B)}H${q(w)}`,`M${q(L)} ${q(h/2)}H${q(w*.92)}`);break;
    case 'T':S.push(`M0 ${q(T)}H${q(w)}`,`M${q(c)} ${q(T)}V${q(h)}`);break;
    case 'H':S.push(`M${q(L)} 0V${q(h)}`,`M${q(R)} 0V${q(h)}`,`M${q(L)} ${q(h/2)}H${q(R)}`);break;
    case 'O':S.push(`M${q(L+gx)} ${q(T)}H${q(R-gx)}${a(R,T+gy,1)}V${q(B-gy)}${a(R-gx,B,1)}H${q(L+gx)}${a(L,B-gy,1)}V${q(T+gy)}${a(L+gx,T,1)}Z`);break;
    case 'D':{
      const dx=Math.min(F.rxD??F.rx,w-sw-.2),dy=Math.min(F.ryD??F.ry,(h-sw)/2);
      S.push(`M${q(L)} ${q(T)}H${q(R-dx)}${a(R,T+dy,1,dx,dy)}V${q(B-dy)}${a(R-dx,B,1,dx,dy)}H${q(L)}Z`);break;}
    case 'U':S.push(`M${q(L)} 0V${q(B-gy)}${a(L+gx,B,0)}H${q(R-gx)}${a(R,B-gy,0)}V0`);break;
    case 'C':case 'G':{
      const ct=F.ct??.34,p0=arm(h*ct,true);
      let d=`M${q(p0.x)} ${q(p0.y)}${p0.straight?`V${q(T+gy)}`:''}${a(R-gx,T,0)}H${q(L+gx)}${a(L,T+gy,0)}V${q(B-gy)}${a(L+gx,B,0)}H${q(R-gx)}`;
      if(ch==='C'){const p1=arm(h*(1-ct),false);d+=p1.straight?`${a(R,B-gy,0)}V${q(p1.y)}`:a(p1.x,p1.y,0);}
      else d+=`${a(R,B-gy,0)}V${q(Math.min(h*(F.gb??.53),B-gy))}H${q(w*(F.gin??.52))}`;
      S.push(d);break;}
    case 'P':case 'R':{
      const mid=h*(F.pm??(ch==='P'?.57:.54)),py=Math.min(gy,(mid-T)/2);
      S.push(`M${q(L)} ${q(h)}V${q(T)}H${q(R-gx)}${a(R,T+py,1,gx,py)}V${q(mid-py)}${a(R-gx,mid,1,gx,py)}H${q(L)}`);
      if(ch==='R')poly([[w*.4,mid-s*.6],[w*.4+dw,mid-s*.6],[w,h],[w-dw,h]]);
      break;}
    case 'S':{
      const ax=(w-sw)/2,ay=(h/2-T)/2,ya=T+ay,yb=h/2+ay,k=Math.PI/180*32;
      S.push(`M${q(c+ax*Math.cos(k))} ${q(ya-ay*Math.sin(k))}${a(c,T,0,ax,ay)}${a(c,h/2,0,ax,ay)}${a(c,B,1,ax,ay)}${a(c-ax*Math.cos(k),yb+ay*Math.sin(k),1,ax,ay)}`);
      break;}
    case 'Z':S.push(`M0 ${q(T)}H${q(w)}`,`M0 ${q(B)}H${q(w)}`);poly([[w-dw*1.15,sw],[w,sw],[dw*1.15,h-sw],[0,h-sw]]);break;
    case 'A':case 'V':{
      // k half the flat apex, f foot width; a heavy face (F.A / F.V) sets its small counter directly.
      const o=F[ch]??{},k=o.k!=null?o.k*w:sw*.5,f=o.f!=null?o.f*w:sw*.95,y=ch==='A'?v=>v:v=>h-v;
      if(ch==='V'){const nd=o.n!=null?o.n*h:h*(1-(f-k)/(c-k));poly([[0,0],[f,0],[c,nd],[w-f,0],[w,0],[c+k,h],[c-k,h]]);break;}
      const a0=o.a0!=null?o.a0*h:Math.min(h*(f-k)/(c-k),h*.3),b1=(o.b1??.64)*h,b2=o.b2!=null?o.b2*h:b1+sw*.75;
      const gap=v=>(c-f)*(v-a0)/(h-a0),g0=o.g0!=null?o.g0*w:gap(b1),g=o.g!=null?o.g*w:gap(b2);
      poly([[c-k,0],[c+k,0],[w,h],[w-f,h],[c+g,b2],[c-g,b2],[f,h],[0,h]]);
      P[P.length-1]+=pts([[c,a0],[c-g0,b1],[c+g0,b1]]); // wound the other way: a counter
      break;}
    case 'M':{
      const o=F.M??{},tip=o.tip!=null?o.tip*w:dw*.25,vd=(o.vd??.68)*h,m=vd/(c-tip);
      const top=o.a!=null?o.a*w:dw,nd=o.n!=null?o.n*h:m*(c-dw),e=o.e!=null?o.e*h:m*sw;
      poly([[0,0],[top,0],[c,nd],[w-top,0],[w,0],[w,h],[w-sw,h],[w-sw,e],[c+tip,vd],[c-tip,vd],[sw,e],[sw,h],[0,h]]);
      break;}
    case 'N':S.push(`M${q(L)} 0V${q(h)}`,`M${q(R)} 0V${q(h)}`);poly([[0,0],[dw,0],[w,h],[w-dw,h]]);break;
    case 'K':{
      const o=F.K??{},at=o.at!=null?o.at*w:dw*1.15,lt=o.lt!=null?o.lt*w:dw*1.2,y1=(o.y1??.42)*h,y2=(o.y2??.74)*h,ly=(o.ly??.56)*h,p=o.p??.45;
      S.push(`M${q(L)} 0V${q(h)}`);
      poly([[w-at,0],[w,0],[sw*.9,y2],[sw*.9,y1]]);
      poly([[sw*.9,ly],[w+(sw*.9-w)*p,y2*p],[w,h],[w-lt,h]]);
      break;}
    case 'W':{
      const b1=w*.26,b2=w*.74,d=sw*.9;
      for(const [top,b] of [[0,b1],[c-d/2,b1],[c-d/2,b2],[w-d,b2]])poly([[top,0],[top+d,0],[b+d/2,h],[b-d/2,h]]);
      break;}
  }
  return {w,S:S.join(''),P:P.join('')};
}
// One centred line of drawn capitals. `width` sets the line length by adjusting the gaps.
function line(str,cx,top,F,color,{width,gap}={}){
  const gs=[...str].map(ch=>glyph(ch,F)),n=gs.length-1,sum=gs.reduce((t,g)=>t+g.w,0);
  const gp=width!=null&&n?(width-sum)/n:(gap??F.gap??F.sw*.6);
  let x=0,S='',P='';
  for(const g of gs){
    const tr=`<g transform="translate(${q(x)} 0)">`;
    if(g.S)S+=`${tr}<path d="${g.S}"/></g>`;
    if(g.P)P+=`${tr}<path d="${g.P}"/></g>`;
    x+=g.w+gp;
  }
  return `<g transform="translate(${q(cx-(sum+gp*n)/2)} ${q(top)})"><g fill="none" stroke="${color}" stroke-width="${q(F.sw)}" stroke-miterlimit="8">${S}</g><g fill="${color}">${P}</g></g>`;
}
// Small set type that really is a plain sans on the can; `sx` condenses it.
const small=(x,y,label,size,fill,sx=1,attrs='')=>`<g transform="translate(${x} ${y}) scale(${sx} 1)">${text(0,0,label,size,fill,`font-weight="bold" ${attrs}`)}</g>`;

/* ───────── High Noon: 12 oz slim can, sun disc on blue over white ───────── */
const HN={blue:'#58a2e2',sun:'#f5c838',ink:'#4c93d4',white:'#f5f5f2'};
const hnLogo={W:10.5,h:10.8,sw:2.36,rx:4.07,ry:4.22,wf:{H:.66,N:.69},ct:.27,gin:.5,dw:2.6};
const hnType={W:4.4,h:6.9,sw:1.5,rx:1.45,ry:2.7,rxD:2.4,ryD:2.7,ct:.3};
const hnName=(W,sw)=>({W,h:9,sw,rx:(W-sw)/2,ry:2.5,ct:.3});
// The sun mark: a yellow disc nearly as wide as the can, HIGH / NOON reversed out in the field blue.
const hnSun=`<circle cx="100" cy="91" r="30.2" fill="${HN.sun}"/>${line('HIGH',100,79.35,hnLogo,HN.blue,{width:37.5})}${line('NOON',100,93.85,hnLogo,HN.blue,{width:43.8})}`;
const hnPeach=`<g transform="translate(100 177.2) scale(.2) translate(-73.5 -58.8)">
<path d="M73 98.6C70.5 98.6 69.5 96.5 67.5 95.5C52 92 41.4 78 41.4 62C41.4 46 51 35 63 35C68 35 71.5 36.5 74.3 38.5C78 36.3 85 35.5 90 36.5C100 38.5 106.4 49 106.4 62C106.4 78 96 92 78.5 95.5C76.5 96.5 75.5 98.6 73 98.6Z" fill="#aa655e"/>
<path d="M75.5 38C83 40.5 88.5 46 91.5 53.5C86.5 47 82 43.5 75.5 41Z" fill="#f6f1ee"/>
<path d="M49 71C46.5 62 48 54 52.5 51C54.2 51.5 53.6 53 52.6 55C50.2 60 49.6 65 50.2 71Z" fill="#f6f1ee"/>
<path d="M71.6 22q0-3 3-3t3 3L76.4 38.8h-4.6Z" fill="#4c9a3c"/>
<path d="M75.5 37.5C78 27 88 22.5 97.5 23C95 32 86.5 38 75.5 37.5Z" fill="#4c9a3c"/></g>`;
const hnMelon=`<g transform="translate(98.7 176.2) rotate(-46.6) scale(.195)">
<path d="M-36 0A36 36 0 0 0 36 0Z" fill="#a81d24"/>
<path d="M-41 0A41 41 0 0 0 41 0" fill="none" stroke="#4d962c" stroke-width="5.4"/>
${[30,60,90,120,150].map(d=>{const t=d*Math.PI/180;return `<ellipse cx="${q(22.5*Math.cos(t))}" cy="${q(22.5*Math.sin(t))}" rx="3.6" ry="2.3" transform="rotate(${d} ${q(22.5*Math.cos(t))} ${q(22.5*Math.sin(t))})" fill="#5aa832"/>`;}).join('')}</g>`;
function highNoon({slug,flavor,art,nameColor,nameWidth,nameFont}){
  const copy=(y,parts,size=3.4,sx=.73)=>`<g transform="translate(100 ${y}) scale(${sx} 1)"><text text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" font-weight="bold" fill="${HN.ink}" letter-spacing=".12">${parts.map((p,i)=>i%2?`<tspan font-family="Georgia,serif" font-style="italic" font-weight="normal" font-size="${q(size*1.2)}">${p}</tspan>`:p).join('')}</text></g>`;
  const label=`<path d="M60 48h80v86H60Z" fill="${HN.blue}"/>
${small(100,45.6,'NO ADDED SUGAR  •  100 CALORIES  •  GLUTEN FREE',3.5,HN.ink,.78,'letter-spacing=".3"')}
${hnSun}
${line('VODKA',100,145.6,hnType,HN.ink,{width:26.3})}${line('SELTZER',100,155.9,hnType,HN.ink,{width:32.6})}
${art}
${line(flavor,100,188.4,nameFont,nameColor,{width:nameWidth})}
${copy(206.2,['VODKA ','with',' REAL FRUIT JUICE,'])}${copy(211.6,['SPARKLING WATER ','and',' NATURAL FLAVORS'])}
${copy(220.4,['4.5% ALC. ','by',' VOLUME  |  355 ML'],3,.84)}`;
  return can(slug,`High Noon ${flavor[0]+flavor.slice(1).toLowerCase()}`,label,{slim:true,color:HN.white});
}

/* ───────── Cutwater: standard 12 oz can, white over a patterned field ───────── */
const CW={navy:'#1a2370',white:'#f4f4f1'};
// Wordmark traced by measurement from the brand's own logo (500x87 px grid): notched C,
// flat-footed W and the A with a wedge for its bar.
const cwWordmark=(cx,top,width)=>{const k=width/459;return `<g transform="translate(${q(cx-239.5*k)} ${q(top-7*k)}) scale(${q(k)})" fill="${CW.navy}" fill-rule="evenodd">
<path d="M15 7H49Q54 7 54 12V29L39 35.5V21H26V66H39V51.5L54 58V75Q54 80 49 80H15Q10 80 10 75V12Q10 7 15 7Z"/>
<path d="M67 7H83V66H96V7H112V75Q112 80 107 80H72Q67 80 67 75Z"/>
<path d="M123 7H169V21H154V80H138V21H123Z"/>
<path d="M178 7H192L201 51L211 7H221L231 50L239 7H253L239.5 80H226L216 35L206.5 80H192Z"/>
<path d="M275 7H292L309.5 80H295L292 66H278L289 52L283 26L273 80H257Z"/>
<path d="M311 7H357V21H342V80H326V21H311Z"/>
<path d="M368 7H407V21H384V36H401V50H384V66H407V80H368Z"/>
<path d="M420 7H461Q466 7 466 12V47Q466 53 459 53H456.5L468.5 80H453.5L441 53H436V80H420ZM436 21H451V39H436Z"/></g>`;};
// The eagle: swept upper wings joined at the head, a lower pair meeting in a V.
const cwEagle=(cx,top,width)=>{const k=width/396;return `<g transform="translate(${cx} ${top}) scale(${q(k)})" fill="${CW.navy}" fill-rule="evenodd">
<path d="M-198 0H-58Q-36 2 -26 15L-14 31Q0 35 14 31L26 15Q36 2 58 0H198L144 31H54L31 48L4 87L0 93L-4 87L-31 48L-54 31H-144ZM-14 39H14L13 49L0 76L-13 49Z"/>
<path d="M0 54L9 59L4 70Z"/>
<path d="M-120 48H-60Q-52 49 -47 57L0 111L47 57Q52 49 60 48H120L0 120Z"/></g>`;};
const cwField='M50 129H55L100 166L145 129H150V240H50Z';
// A lime half-wheel: flat cut edge on the local x axis, dome towards +y. `drop` offsets the dark shape behind it.
function limeHalf(cx,cy,r,rot,{rind,pith,flesh,accent,shade,drop=[0,0],n=5,edge=.88}){
  const pt=(a,rr)=>`${q(rr*Math.cos(a*Math.PI/180))} ${q(rr*Math.sin(a*Math.PI/180))}`;
  const seg=(a0,a1,ri,ro,fill)=>`<path d="M${pt(a0,ri)}L${pt(a0,ro)}A${q(ro)} ${q(ro)} 0 0 1 ${pt(a1,ro)}L${pt(a1,ri)}Z" fill="${fill}"/>`;
  const half=(rr,fill)=>`<path d="M${q(-rr)} 0A${q(rr)} ${q(rr)} 0 0 0 ${q(rr)} 0Z" fill="${fill}"/>`;
  const step=180/n,pad=step*.15;let segs='';
  for(let i=0;i<n;i++){
    const a0=i*step+pad,a1=(i+1)*step-pad;
    segs+=seg(a0,a1,r*.15,r*.75,flesh);
    if(accent)segs+=i%2?seg(a0,a1,r*.56,r*.75,accent):seg(a0,a0+(a1-a0)*.42,r*.15,r*.75,accent);
  }
  return `${shade?`<g transform="translate(${q(cx+drop[0])} ${q(cy+drop[1])}) rotate(${rot})">${half(r*1.04,shade)}</g>`:''}<g transform="translate(${q(cx)} ${q(cy)}) rotate(${rot})">${half(r,rind)}${half(r*edge,pith)}${segs}</g>`;
}
// Agave rosette: straight spikes fanned from one point. [angle, length, width, colour]
const agave=(cx,cy,leaves)=>leaves.map(([deg,len,w,fill])=>{const t=deg*Math.PI/180,dx=Math.cos(t),dy=Math.sin(t);return `<path d="${pts([[cx-dy*w/2,cy+dx*w/2],[cx+dx*len*.36-dy*w*.56,cy+dy*len*.36+dx*w*.56],[cx+dx*len,cy+dy*len],[cx+dx*len*.36+dy*w*.56,cy+dy*len*.36-dx*w*.56],[cx+dy*w/2,cy-dx*w/2]])}" fill="${fill}"/>`;}).join('');
// Mint leaf from stem (x0,y0) to tip (x1,y1) with a serrated edge. `a` colours the half to the
// right of the stem-to-tip direction, `b` the other; `stripe` lays veins over the half chosen by `stripeSide` (1 = b, -1 = a).
function mint(x0,y0,x1,y1,w,{a,b,stripe,stripeSide=1,rib}){
  const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
  const hw=t=>w/2*Math.pow(Math.sin(Math.PI*Math.pow(t,.66)),.7);
  const at=(t,o)=>[x0+dx*t+nx*o,y0+dy*t+ny*o];
  const side=sign=>{const out=[];for(let i=1;i<24;i++){const t=i/24;out.push(at(t,sign*hw(t)*(i%2?1:.84)));}return out;};
  const half=sign=>pts([[x0,y0],...side(sign),[x1,y1]]);
  let bands='';
  if(stripe)for(let i=0;i<6;i++){const t=.07+i*.145;bands+=`<path d="${pts([at(t,0),at(t+.075,0),at(t+.2,stripeSide*hw(Math.min(.98,t+.2))*.82),at(t+.11,stripeSide*hw(Math.min(.98,t+.11))*.84)])}" fill="${stripe}"/>`;}
  return `<path d="${half(-1)}" fill="${a}"/><path d="${half(1)}" fill="${b}"/>${bands}<path d="M${q(x0)} ${q(y0)}L${q(x1)} ${q(y1)}" stroke="${rib}" stroke-width=".6" fill="none"/>`;
}
function cutwater({slug,title,lines,fonts,widths,alc,alcColor,field,pattern,copy}){
  const [edge,mid]=field;
  const label=`${small(100,57.4,'MADE WITH AWARD-WINNING REAL SPIRITS',3.5,'#a4a9ac',1,'letter-spacing=".75"')}
${cwWordmark(100,65.8,55)}
${line(lines[0],100,82,fonts[0],CW.navy,{width:widths[0]})}${line(lines[1],100,104.5,fonts[1],CW.navy,{width:widths[1]})}
${small(100,139.8,alc,3.8,alcColor,1,'letter-spacing=".6"')}
<path d="${cwField}" fill="${ref('fieldfill')}"/><g clip-path="${ref('field')}">${pattern}</g>
${cwEagle(100,149.6,28)}
${copy.map((c,i)=>small(100,q(190.8+i*4.6),c,3.4,'#fbfbf6',1,'letter-spacing=".3"')).join('')}`;
  return can(slug,title,label,{color:CW.white,defs:`<clipPath id="__ID__field"><path d="${cwField}"/></clipPath><linearGradient id="__ID__fieldfill"><stop stop-color="${edge}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${edge}"/></linearGradient>`});
}
// The titles are a very heavy condensed grotesque: counters are slots, diagonals taper.
const heavy={A:{k:.19,f:.42,a0:.26,b1:.64,b2:.75,g0:.11,g:.065},V:{k:.155,f:.375,n:.6},M:{a:.3,n:.47,vd:.78,tip:.08,e:.44},K:{at:.5,lt:.47,y1:.44,y2:.78,ly:.59,p:.47}};
const limeFont={W:6.6,h:19,sw:2.7,rx:1.5,ry:1.5,wf:{L:.82,E:.82,M:1.32},...heavy};
const margFont={W:6.3,h:19,sw:2.35,rx:1.4,ry:1.4,wf:{M:1,A:1,R:1.04,T:.81},gb:.52,gin:.5,ct:.33,...heavy};
const muleFont={W:8.4,h:19,sw:3.1,rx:1.8,ry:1.8,wf:{V:.98,D:1.03,K:1.03,A:.95,M:1.33,L:.81,E:.73},...heavy};
const MG={lime:'#a9d83a',navy:'#1f2c88',teal:'#0b7b67',mid:'#1fb88b',pith:'#fbfbf4'};
const mgLime={rind:MG.lime,pith:MG.pith,flesh:MG.mid,accent:MG.lime,shade:MG.teal};
const margPattern=`${agave(92,150,[[200,30,2,MG.lime],[178,31,6.6,MG.navy],[158,27,5.6,MG.teal],[143,33,2,MG.lime],[128,35,6.4,MG.navy],[112,30,5.6,MG.teal],[97,33,5.6,MG.navy],[84,27,2,MG.lime],[70,30,6,MG.teal],[55,24,2,MG.lime]])}
${limeHalf(122.5,166,16.5,-35,{...mgLime,drop:[-3.6,2.8]})}
${limeHalf(149,178,14,82,{...mgLime,drop:[-3,2.4]})}
${limeHalf(56,181,10,-112,{...mgLime,drop:[-1.5,2.6],n:4})}
${limeHalf(79.8,209.2,20,37,{...mgLime,drop:[-2.4,-3]})}
${agave(139,230,[[202,26,5,MG.teal],[222,28,2,MG.lime],[240,32,5.6,MG.navy],[256,35,5,MG.teal],[271,38,5.6,MG.navy],[286,32,2,MG.lime],[300,30,5,MG.navy]])}`;
const MU={leaf:'#2f7f3c',leaf2:'#4a9a48',lime:'#a7d82f',pale:'#e6ecea',rind:'#2c7a37',glow:'#c9e84f',rib:'#245e2e'};
const muLime={rind:MU.rind,pith:MU.pale,flesh:MU.lime,accent:MU.glow,edge:.84};
const mulePattern=`${mint(72,128,66,189,20,{a:MU.pale,b:MU.leaf,stripe:MU.lime,stripeSide:-1,rib:MU.rib})}
${mint(74,143,96,184,28,{a:MU.leaf,b:MU.leaf2,rib:MU.rib})}
${limeHalf(125,175,20,154,muLime)}
${mint(130,180,146,224,19,{a:MU.leaf,b:MU.pale,stripe:MU.lime,rib:MU.rib})}
${mint(140,213,112,223,14,{a:MU.leaf,b:MU.leaf2,rib:MU.rib})}
${limeHalf(74,228,22,200,muLime)}
${mint(88,229,104,207,9,{a:MU.pale,b:MU.leaf,stripe:MU.lime,stripeSide:-1,rib:MU.rib})}${mint(90,230,116,214,11,{a:MU.pale,b:MU.leaf,stripe:MU.lime,stripeSide:-1,rib:MU.rib})}`;

const date='2026-11-15';
const hnPackage=flavor=>`Current US 12 fl oz (355 mL) slim can of High Noon ${flavor}, as shown on the manufacturer's product page today. High Noon now labels this drink "Vodka Seltzer"; the catalog row and the older can say "Vodka Soda" / "Vodka & Soda". Same product and flavor; the current single can was drawn.`;
const hnUncertainty='The older "VODKA & SODA" can (sun disc with SUN SIPS, "MADE WITH REAL JUICE") is still shown by some retailers; the current manufacturer packshot was preferred. Can drawn at the house slim-can proportions, a little narrower than the photographed can, so the blue field is slightly taller relative to the disc. Lettering is redrawn geometry, not the brand typeface. The two descriptor lines and the ABV line are set in small type; the wraparound rim line is cropped by the can edge as in the packshot.';
const cwUncertainty='Can drawn at the house standard-can proportions, narrower than the photographed can, so the title capitals are a little more condensed. Title lettering is redrawn geometry approximating the condensed grotesque, not the brand typeface. The lower pattern is a simplified redraw of the printed illustration (fewer, cleaner shapes); the round "MADE WITH REAL …" side medallion that wraps off the left/right edge is omitted. Registered-mark symbol omitted.';
export const records=[
  {
    slug:'high-noon-vodka-soda-watermelon',family:'high-noon-slim-can',
    packageChoice:hnPackage('Watermelon'),
    references:[{pageUrl:'https://www.highnoonspirits.com/watermelon-vodka-seltzer.html',imageUrl:'https://www.highnoonspirits.com/dw/image/v2/bfwt_prd/on/demandware.static/-/Sites-highnoon-Library/default/dw9aa0a87d/Products/August%202026%20Cans/HNB_VdkaWate_NV_355_front_210088047.png',inspectedAt:date,visuallyInspected:true,
      observations:'Straight-on front packshot of a tall slim can. White neck with a rim line in blue capitals (NO ADDED SUGAR • 100 CALORIES • GLUTEN FREE). Sky-blue field over roughly the upper half holding a golden-yellow disc almost as wide as the can, with HIGH / NOON reversed out in the field blue in two lines of wide geometric capitals. White lower half: VODKA / SELTZER in blue condensed capitals, a tilted watermelon wedge (dark red flesh, green seeds, white gap, green rind), WATERMELON in green condensed capitals, two blue descriptor lines and a 4.5% ALC. / 355 ML line.'},
     {pageUrl:'https://www.acebevdc.com/products/high-noon-watermelon-vodka-soda-cans-4-pack',imageUrl:'https://www.acebevdc.com/cdn/shop/files/d90e58d0b8f0e3ac90dd656a4d834dc6.png?v=1726155318',inspectedAt:date,visuallyInspected:true,
      observations:'The reference recorded by the rejected batch: the earlier "VODKA & SODA" can with SUN SIPS under the wordmark and MADE WITH REAL JUICE under the flavor. Same sun-on-blue structure; used only to confirm the product, not drawn.'}],
    uncertainty:hnUncertainty,status:'needs-review',
    svg:highNoon({slug:'high-noon-vodka-soda-watermelon',flavor:'WATERMELON',art:hnMelon,nameColor:'#4d942c',nameWidth:41.4,nameFont:hnName(3.4,1.3)}),
  },
  {
    slug:'high-noon-vodka-soda-peach',family:'high-noon-slim-can',
    packageChoice:hnPackage('Peach'),
    references:[{pageUrl:'https://www.highnoonspirits.com/peach-vodka-seltzer.html',imageUrl:'https://www.highnoonspirits.com/dw/image/v2/bfwt_prd/on/demandware.static/-/Sites-highnoon-Library/default/dw6d72eac1/Products/August%202026%20Cans/HNB_VdkaPeac_NV_355_front_210085151.png',inspectedAt:date,visuallyInspected:true,
      observations:'Straight-on front packshot of a tall slim can, same layout as the other flavors: white neck with a blue rim line, sky-blue upper field with the large golden-yellow disc and HIGH / NOON reversed out in blue, white lower half with VODKA / SELTZER in blue condensed capitals. Flavor art is a single dusty-pink peach with a green stem and leaf and two white highlights; PEACH below in the same dusty pink; two blue descriptor lines and the 4.5% ALC. / 355 ML line.'},
     {pageUrl:'https://www.delmesaliquor.com/products/high-noon-peach-vodka-soda-4-pack',imageUrl:'https://www.delmesaliquor.com/cdn/shop/products/HighNoonPeachVodka_Soda_grande.png?v=1629069702',inspectedAt:date,visuallyInspected:true,
      observations:'The reference recorded by the rejected batch: a 2021 photo of the earlier "VODKA & SODA" can (SUN SIPS, MADE WITH REAL JUICE), covered in condensation. Same sun-on-blue structure; used only to confirm the product, not drawn.'}],
    uncertainty:hnUncertainty,status:'needs-review',
    svg:highNoon({slug:'high-noon-vodka-soda-peach',flavor:'PEACH',art:hnPeach,nameColor:'#aa625c',nameWidth:20.8,nameFont:hnName(3.9,1.45)}),
  },
  {
    slug:'cutwater-spirits-margarita',family:'cutwater-cocktail-can',
    packageChoice:'Current US 12 fl oz (355 mL) standard can of Cutwater Lime Margarita, 12.5% ABV. The catalog row says only "Margarita"; Lime Margarita is Cutwater\'s standard margarita (the others are named flavors such as Mango or Strawberry), so that can was drawn.',
    references:[{pageUrl:'https://www.cutwaterspirits.com/canned-cocktails/lime-margarita',imageUrl:'https://bevmo.com/cdn/shop/files/b73ab8dd-17cd-4ed1-905e-96c7813088eb-padded_b108dd9b-df97-4758-987f-b9f65e29028a.png?v=1771273308',inspectedAt:date,visuallyInspected:true,
      observations:'Front packshot of a standard 12 oz can. White upper half: grey rim line (MADE WITH AWARD-WINNING REAL SPIRITS), blocky navy CUTWATER wordmark, LIME / MARGARITA in tall condensed navy capitals, 12.5% ALC. BY VOL. in dark green, and the navy eagle emblem at the point of a white V. Below the V a bright green field with navy, teal and lime agave spikes and white-outlined lime wedges, and three lines of small white copy (MARGARITA MADE WITH CUTWATER TEQUILA, TRIPLE SEC & LIME JUICE). Wordmark and eagle construction checked against the logo files on cutwaterspirits.com.'}],
    uncertainty:cwUncertainty,status:'needs-review',
    svg:cutwater({slug:'cutwater-spirits-margarita',title:'Cutwater Lime Margarita',lines:['LIME','MARGARITA'],fonts:[limeFont,margFont],widths:[28,60.6],alc:'12.5% ALC. BY VOL.',alcColor:'#0c6c5b',field:['#0a9b76','#10c092'],pattern:margPattern,copy:['MARGARITA MADE WITH','CUTWATER TEQUILA,','TRIPLE SEC & LIME JUICE']}),
  },
  {
    slug:'cutwater-spirits-vodka-mule',family:'cutwater-cocktail-can',
    packageChoice:'Current US 12 fl oz (355 mL) standard can of Cutwater Vodka Mule, 7% ABV, as shown on the manufacturer\'s product page.',
    references:[{pageUrl:'https://www.cutwaterspirits.com/canned-cocktails/vodka-mule',imageUrl:'https://cdn.builder.io/api/v1/image/assets%2F7405b7c3d2954599a0e1a3c04cde0d38%2F390d6fb979eb48fbaeb41762f1af3471?width=1200',inspectedAt:date,visuallyInspected:true,
      observations:'Manufacturer front packshot of a standard 12 oz can (with condensation, not drawn). Same structure as the margarita: white upper half with the grey rim line, navy CUTWATER wordmark, VODKA / MULE in heavy condensed navy capitals, 7% ALC. BY VOL. in grey, and the navy eagle at the point of a white V. Below it a copper-orange field with serrated mint leaves (solid green, and green with white-and-lime striped halves) and lime wheels with bright lime segments, and three lines of small white copy (CUTWATER VODKA WITH GINGER BEER & LIME FLAVOR). The Meijer image recorded by the rejected batch no longer downloads (returns an HTML page).'}],
    uncertainty:cwUncertainty,status:'needs-review',
    svg:cutwater({slug:'cutwater-spirits-vodka-mule',title:'Cutwater Vodka Mule',lines:['VODKA','MULE'],fonts:[muleFont,muleFont],widths:[49.8,39.6],alc:'7% ALC. BY VOL.',alcColor:'#8b9094',field:['#a9592a','#cc8a43'],pattern:mulePattern,copy:['CUTWATER VODKA','WITH GINGER BEER','& LIME FLAVOR']}),
  },
];
