import {wrap,shadow,ref} from '../style.mjs';

// Generic catalog drinks use documented unbranded servings. Glassware and
// garnish follow inspected recipe photographs, not category assumptions.
const ice=(x,y,angle=0,w=25,h=25)=>`<g transform="translate(${x} ${y}) rotate(${angle})"><rect width="${w}" height="${h}" rx="4" fill="${ref('ice')}" stroke="#fffdf1" stroke-opacity=".6" stroke-width=".8"/><path d="M4 ${h-4}V7Q4 4 7 4h${w-13}" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="1.1"/><path d="m5 ${h-3} ${w-9}-2" fill="none" stroke="#a5bcac" stroke-opacity=".3" stroke-width=".6"/></g>`;
const wedge=(x,y,r=20,angle=0,orange=false)=>`<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M${-r} 0A${r} ${r} 0 0 0 ${r} 0Z" fill="${orange?'#d67b16':'#578b2d'}"/><path d="M${-r+2} 0A${r-2} ${r-2} 0 0 0 ${r-2} 0Z" fill="${orange?'#ffe3a2':'#e3edb0'}"/><path d="M${-r+4} 1A${r-4} ${r-4} 0 0 0 ${r-4} 1Z" fill="${orange?'#f6b43e':'#bcd37b'}"/>${Array.from({length:5},(_,i)=>{const a=(i+1)*Math.PI/6;return `<path d="M0 0 ${Math.cos(a)*(r-4)} ${Math.sin(a)*(r-4)}" stroke="${orange?'#fff0bc':'#f4f7cd'}" stroke-width=".7"/>`;}).join('')}</g>`;
const mint=(x,y,s=1,a=0)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M0 0C-14-5-19-16-12-28 3-24 8-12 0 0Z" fill="${ref('mint')}" stroke="#477b2f" stroke-width=".6"/><path d="M0 0-11-25m4 15-7-4m5-2 5-6" fill="none" stroke="#d0df8b" stroke-width=".7"/></g>`;
function defs(color,dark,extra='') {
 return `<linearGradient id="__ID__liquid"><stop stop-color="${dark}"/><stop offset=".25" stop-color="${color}"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="__ID__ice" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffffff" stop-opacity=".56"/><stop offset=".45" stop-color="#f5f9e4" stop-opacity=".13"/><stop offset="1" stop-color="#d4e1cf" stop-opacity=".39"/></linearGradient><linearGradient id="__ID__base"><stop stop-color="#d4e1db" stop-opacity=".6"/><stop offset=".35" stop-color="#fcfff4" stop-opacity=".9"/><stop offset="1" stop-color="#9cb2a6" stop-opacity=".7"/></linearGradient><linearGradient id="__ID__mint"><stop stop-color="#48792e"/><stop offset=".4" stop-color="#94b64d"/><stop offset="1" stop-color="#315f2b"/></linearGradient>${extra}`;
}
const tall='M59 71Q100 59 141 71L137 215Q137 234 100 234T63 215Z';
const short='M48 108Q100 92 152 108L147 215Q147 234 100 234T53 215Z';
function glassDrink(slug,title,{color,dark,top=71,shape=tall,rx=41,content='',garnish='',handle=false,blueRim=false,etched=false}={}) {
 const handleArt=handle?`<path d="M61 107C23 96 20 125 24 160S43 204 63 194" fill="none" stroke="#a9bdb0" stroke-opacity=".7" stroke-width="7"/><path d="M60 107C27 100 24 124 28 158S43 196 62 190" fill="none" stroke="#f9fff1" stroke-opacity=".8" stroke-width="2.1"/>`:'';
 const liquidShape=shape===short?'M53 123Q100 112 147 123L143 212Q143 226 100 226T57 212Z':'M63 86Q100 76 137 86L133 213Q133 226 100 226T67 213Z';
 return wrap(slug,title,`${shadow(rx+5)}${handleArt}<path d="${shape}" fill="${ref('glass')}" stroke="#afc1b4" stroke-opacity=".75" stroke-width=".9"/>
<path d="${liquidShape}" fill="${ref('liquid')}"/>
<ellipse cx="100" cy="${top+15}" rx="${rx-4}" ry="9" fill="${color}" opacity=".8"/>
<g clip-path="${ref('cupclip')}">${content}
${etched?`${[65,78,91,109,122,135].map((x,i)=>`<path d="M${x} ${top+13} ${x+(100-x)*.13} 220" fill="none" stroke="#f2f9e5" stroke-opacity=".35" stroke-width="1.2"/>`).join('')}<path d="M52 140q48 10 96 0M54 177q46 9 92 0M56 210q44 8 88 0" fill="none" stroke="#b9cfbe" stroke-opacity=".4" stroke-width="1"/>`:''}
<path d="${shape}" fill="${ref('glass')}" opacity=".42"/>
</g>
<path d="M${100-rx+7} ${top+19} ${100-rx+10} 208" fill="none" stroke="#fff" stroke-opacity=".53" stroke-width="2.3" stroke-linecap="round"/>
<path d="M${100+rx-6} ${top+21} ${100+rx-10} 209" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.3"/>
<path d="M${100-rx+5} 218q${rx-5} 16 ${2*rx-10} 0l-1 10q${-rx+6} 12 ${-2*rx+12} 0Z" fill="${ref('base')}"/>
<ellipse cx="100" cy="${top}" rx="${rx}" ry="10" fill="none" stroke="${blueRim?'#163e8c':'#eaf6e8'}" stroke-width="${blueRim?'4':'1.8'}"/>
<path d="M${100-rx+1} ${top+1}q${rx-1} 15 ${2*rx-2} 0" fill="none" stroke="#c4d6c7" stroke-opacity=".4" stroke-width=".8"/>
${garnish}`,defs(color,dark,`<clipPath id="__ID__cupclip"><path d="${shape}"/></clipPath>`));
}
const oldFashioned=glassDrink('generic-old-fashioned','Old Fashioned',{shape:short,top:108,rx:52,color:'#c67b23',dark:'#7d431a',etched:true,
 content:`${ice(58,124,-12,38,38)}${ice(104,119,14,35,39)}${ice(83,165,11,38,39)}`,
 garnish:`${ice(68,102,-9,32,29)}${wedge(113,82,30,-5,true)}<circle cx="126" cy="106" r="10" fill="#631f25"/><ellipse cx="123" cy="102" rx="3" ry="2" fill="#bf6b58" opacity=".5"/><path d="M108 84V57" stroke="#aeb8aa" stroke-width="1.4"/><ellipse cx="108" cy="55" rx="3" ry="2" fill="none" stroke="#c5cdb9" stroke-width="1.2"/>`});
const mojito=glassDrink('generic-mojito','Mojito',{color:'#e2e8b3',dark:'#bccd92',etched:true,
 content:`${[[-1,0],[14,10],[-12,20]].map(([x,y])=>mint(97+x,215-y,.65,-30+x*3)).join('')}${ice(68,97,-9,31,31)}${ice(104,92,12,26,32)}${ice(82,132,15,30,31)}${ice(106,161,-12,24,30)}${wedge(82,202,16,-15)}`,
 garnish:`<path d="M114 91 126 31" stroke="#7d6642" stroke-width="3"/>${ice(76,65,7,28,24)}${ice(108,62,-12,25,27)}${mint(121,80,.95,-25)}${mint(120,77,.8,32)}${mint(116,73,.7,-63)}`});
const mule=glassDrink('generic-moscow-mule','Moscow Mule',{shape:short,top:108,rx:52,handle:true,color:'#e4e3ba',dark:'#bfc9a4',etched:true,
 content:`${ice(68,123,-13,32,35)}${ice(105,119,15,25,35)}${ice(84,161,-5,31,34)}`,
 garnish:`${ice(76,101,-9,27,25)}${ice(103,102,11,27,26)}${wedge(125,86,24,-28)}`});
const pina=glassDrink('generic-pina-colada','Pina Colada',{color:'#e8dfb7',dark:'#c6ba8c',etched:true,
 content:Array.from({length:14},(_,i)=>`<ellipse cx="${72+i*17%56}" cy="${92+i*29%112}" rx="${i%3+3}" ry="1.4" fill="#fff7dd" opacity=".18"/>`).join(''),
 garnish:`<g transform="translate(69 58) rotate(-20)"><path d="M-27-5H27L0 28Z" fill="#f7d569" stroke="#bac16b" stroke-width="1.8"/><path d="M-25-5h50" stroke="#9f9d43" stroke-width="4"/><path d="m-19-3 4-5 6 4 6-5 5 5 5-5 5 5 6-5" stroke="#d7c66d" stroke-width="2" fill="none"/><path d="M0 0 0 19M-13 0l12 16M13 0 1 16" stroke="#fff1ba" stroke-width="1"/></g><path d="M70 61 78 27" stroke="#bec4b2" stroke-width="1.3"/><circle cx="75" cy="42" r="8.6" fill="#b32b25"/><ellipse cx="72" cy="39" rx="2" ry="2.6" fill="#f78c64" opacity=".6"/>`});
function espresso() {
 const bowl='M40 67Q100 50 160 67L111 144Q100 153 89 144Z';
 return wrap('generic-espresso-martini','Espresso Martini',`${shadow(44)}<ellipse cx="100" cy="232" rx="37" ry="7" fill="${ref('base')}" stroke="#c1d0c2" stroke-width="1"/><path d="M96 145v74q0 8-13 11h34q-13-3-13-11v-74Z" fill="${ref('glass')}" stroke="#d5e1d1" stroke-width=".9"/><path d="M100 151v68" stroke="#fffef5" stroke-opacity=".7" stroke-width="1.8"/>
<path d="${bowl}" fill="${ref('glass')}" stroke="#b0c2b4" stroke-width="1"/><path d="M45 72Q100 60 155 72L108 141Q100 148 92 141Z" fill="${ref('liquid')}"/>
<ellipse cx="100" cy="69" rx="55" ry="11" fill="#d2b17b"/><ellipse cx="100" cy="68" rx="52" ry="8.5" fill="#e5c897"/>
${Array.from({length:24},(_,i)=>`<circle cx="${56+i*17%86}" cy="${64+i*7%8}" r="${i%3?.35:.65}" fill="#a28756" opacity=".4"/>`).join('')}
<path d="M48 81 92 140M59 84l35 59M143 83l-36 59M152 78 110 142" fill="none" stroke="#edf3df" stroke-opacity=".35" stroke-width="1.2"/>
<ellipse cx="100" cy="67" rx="60" ry="11" fill="none" stroke="#e6f1e1" stroke-width="1.6"/>
<path d="M70 230q30 8 60 0" fill="none" stroke="#f7fff0" stroke-opacity=".8" stroke-width="1.4"/>`,defs('#48291c','#261d18'));
}
function horchata() {
 const shape='M59 79Q100 67 141 79C146 119 140 169 120 189Q100 209 80 189C60 169 54 119 59 79Z';
 return wrap('horchata-traditional','Traditional Horchata',`${shadow(47)}<ellipse cx="100" cy="233" rx="33" ry="6" fill="${ref('base')}" stroke="#b3c7b6" stroke-width=".9"/><path d="M97 198v25q0 6-12 8h30q-12-2-12-8v-25Z" fill="${ref('glass')}" stroke="#d2dfd0" stroke-width="1"/><path d="M100 202v23" stroke="#fff" stroke-width="1.3" opacity=".65"/><path d="${shape}" fill="${ref('glass')}" stroke="#b2c6b5" stroke-width=".9"/>
<path d="M61 98Q100 88 139 98C141 135 133 171 116 188Q100 202 84 188C67 171 59 135 61 98Z" fill="${ref('liquid')}"/>
<ellipse cx="100" cy="98" rx="39" ry="8.8" fill="#f4e8cc"/>
${ice(77,91,-8,26,23)}${ice(108,92,13,21,23)}
${Array.from({length:17},(_,i)=>`<ellipse cx="${68+i*13%62}" cy="${96+i*7%9}" rx=".65" ry=".35" fill="#8d6d44" opacity=".65"/>`).join('')}
<path d="M64 91q-3 60 19 86M136 91q3 60-19 86" stroke="#fffef1" stroke-opacity=".5" stroke-width="2.1" fill="none"/>
<ellipse cx="100" cy="79" rx="41" ry="10" fill="none" stroke="#e5f2df" stroke-width="1.6"/>`,defs('#eee0bd','#d0bb8e'));
}
const agua=(slug,title,color,dark)=>glassDrink(slug,title,{color,dark,blueRim:true,content:`${ice(69,94,-8,29,30)}${ice(104,91,12,25,30)}${ice(83,134,8,31,34)}${ice(107,171,-10,23,28)}`});
const record=(slug,title,pageUrl,imageUrl,observations,svg,choice)=>({slug,family:'unbranded-served-drink',packageChoice:choice,references:[{pageUrl,imageUrl,inspectedAt:'2026-11-04',visuallyInspected:true,observations}],uncertainty:'Generic catalog identity uses one documented representative serving. Glass engraving and fine texture simplified as original vectors; no brand, product claims or background is included. Variations in recipes/garnishes are not separate catalog identities here. Final aesthetic approval and native-device review pending.',status:'needs-review',svg});
const iba='https://iba-world.com/iba-cocktail/';
const ibaimg='https://iba-world.com/wp-content/uploads/2024/07/';
export const records=[
 record('generic-old-fashioned','Old Fashioned',iba+'old-fashioned/',ibaimg+'iba-cocktail-the-unforgettables-old-fashioned-6694911fce360.webp','IBA serving photograph individually inspected: short cut-glass rocks tumbler, amber drink and large clear ice, orange half-slice and dark cocktail cherry on metal pick. Settled drink with no splash.',oldFashioned,'Unbranded classic Old Fashioned over ice in etched rocks glass, orange/cherry garnish.'),
 record('generic-espresso-martini','Espresso Martini',iba+'espresso-martini/',ibaimg+'iba-cocktail-new-era-espresso-martini-6695d3a172fd3.webp','IBA photograph independently inspected: V-shaped clear stemmed martini glass with fluted bowl and round foot; dark espresso-brown liquid with broad tan crema surface. No visible beans in this selected photograph, so optional coffee-bean garnish omitted.',espresso(),'Unbranded espresso martini in V-shaped stemmed glass with crema; photographed ungarnished presentation.'),
 record('generic-moscow-mule','Moscow Mule',iba+'moscow-mule/',ibaimg+'iba-cocktail-contemporary-classics-moscow-mule-6695cdc7d8cb2.webp','IBA serving photograph independently inspected: clear handled pressed-glass mug with embossed curves, pale cloudy drink and clear ice piled at rim, lime wedge. This reference is glass, not a copper mug; no invented metal finish.',mule,'Unbranded Moscow Mule in documented clear handled glass mug over ice with lime wedge.'),
 record('generic-mojito','Mojito',iba+'mojito/',ibaimg+'iba-cocktail-contemporary-classics-mojito-6695cdc755626.webp','IBA photograph independently inspected: tall clear engraved highball with pale cloudy liquid, muddled green mint at foot, plentiful crushed ice, fresh mint sprigs above rim and a brown straw/stirrer. Recipe specifies lime; simplified lime piece retained in liquid.',mojito,'Unbranded iced Mojito highball with mint, lime and brown straw/stirrer.'),
 record('generic-pina-colada','Pina Colada',iba+'pina-colada/',ibaimg+'iba-cocktail-contemporary-classics-pina-colada-6695cdcabbf00.webp','IBA photograph independently inspected: straight tall clear embossed tumbler, opaque ivory frozen/creamy drink with textured surface, pineapple wedge and red cherry on pick. The pictured vessel is a tumbler, not an assumed hurricane glass.',pina,'Unbranded blended Pina Colada in documented tall tumbler, pineapple/cherry garnish.'),
 record('horchata-traditional','Traditional Horchata','https://www.mexicoinmykitchen.com/aguas-frescas-mexican-fruit-drinks/','https://lh4.ggpht.com/-Z8hbNAxbZV8/TkM-xZ0zBxI/AAAAAAAABcY/0WLkkUoElXQ/HorchatadeArroz2mexicoinmykitchen_th.jpg?imgmax=800','Recipe author photograph individually inspected: ivory rice/cinnamon horchata in a clear round-bowled short-stem goblet with ice and sparse cinnamon flecks; a matching clear pitcher behind. No cinnamon stick in the serving glass, so none invented.',horchata(),'Unbranded Mexican rice/cinnamon horchata, iced, in documented short-stem goblet.'),
 record('agua-fresca-jamaica','Agua Fresca Jamaica','https://www.mexicoinmykitchen.com/agua-de-jamaica/','https://www.mexicoinmykitchen.com/wp-content/uploads/2023/07/Jamaica-Agua-Fresca-2.jpg','Recipe author photograph independently inspected: deep burgundy hibiscus drink in clear tall tumbler with thick cobalt-blue rim, large ice cubes pink-stained by liquid. No fruit garnish or branding in glass.',agua('agua-fresca-jamaica','Agua Fresca Jamaica','#8d253f','#501c30'),'Unbranded iced hibiscus agua fresca in cobalt-rimmed clear tumbler.'),
 record('agua-fresca-tamarindo','Agua Fresca Tamarindo','https://www.mexicoinmykitchen.com/agua-de-tamarindo/','https://www.mexicoinmykitchen.com/wp-content/uploads/2023/03/Tamarind-agua.png','Recipe author photograph independently inspected: opaque/cloudy warm brown tamarind drink in a clear tumbler with thick cobalt-blue rim, large clear ice at top; tamarind pods outside the glass are excluded from icon.',agua('agua-fresca-tamarindo','Agua Fresca Tamarindo','#a8733e','#744c2c'),'Unbranded iced tamarind agua fresca in documented cobalt-rimmed tumbler.'),
];
