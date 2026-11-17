import {wrap, shadow, ref, text} from '../style.mjs';

// Product-specific recipes: 16oz Monster and 12oz slim Celsius/Alani cans.
function can(slug,title,label,{slim=false,color,defs='',blackRim=false,greenTab=false}={}) {
  const l=slim?67:58,r=200-l,rx=100-l-5,t=26;
  const body=`M${l+5} ${t}Q100 ${t-8} ${r-5} ${t}L${r} ${t+15}V220Q${r} 233 100 233T${l} 220V${t+15}Z`;
  return wrap(slug,title,`${shadow(slim?44:54)}<path d="${body}" fill="${color}"/>
<g clip-path="${ref('bodyclip')}">${label}
<path d="${body}" fill="${ref('shade')}" opacity=".8"/>
<path d="M${l+7} 48V213" fill="none" stroke="#fff" stroke-opacity="${blackRim?'.08':'.2'}" stroke-width="2.5"/>
<path d="M${r-4} 48V215" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.2"/>
</g>
<ellipse cx="100" cy="${t}" rx="${rx}" ry="6.8" fill="${ref('metal')}" stroke="${blackRim?'#2a2b2a':'#9ca7a4'}" stroke-width="1.3"/>
<ellipse cx="100" cy="${t}" rx="${rx-4}" ry="4.6" fill="none" stroke="#8d9892" stroke-width=".7"/>
<ellipse cx="104" cy="${t+1}" rx="7" ry="2.8" fill="#657169"/>
<path d="M94 24h9q5 0 4 3t-7 3h-5q-5-1-1-6" fill="none" stroke="${greenTab?'#8cce31':'#e6e8de'}" stroke-width="2.2"/>
<path d="M${l+3} 226q${(r-l-6)/2} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M${l+6} 230q${(r-l-12)/2} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
`<clipPath id="__ID__bodyclip"><path d="${body}"/></clipPath>${defs}`);
}

const claw=`<g fill="${ref('claw')}">
<path d="M69 72 74 69 78 70 82 67 86 69 90 68 94 71 89 77 88 83 90 88 87 94 89 100 86 106 87 113 84 120 85 128 82 137 81 144 79 151 78 140 77 135 79 130 77 123 79 117 77 111 79 106 77 99 79 92 77 86 78 79 74 75 67 75Z"/>
<path d="M88 72 94 68 99 67 103 64 108 67 113 67 117 72 113 76 111 82 113 89 110 95 113 102 110 110 111 117 108 124 107 133 104 143 101 153 99 159 99 145 97 138 99 132 97 124 99 117 97 110 99 103 96 97 98 90 96 83 98 77 94 74Z"/>
<path d="M111 74 116 70 122 69 127 67 130 70 132 76 130 81 131 87 128 94 130 100 128 108 128 115 125 122 124 131 122 140 120 149 118 137 119 130 117 123 119 115 117 109 119 102 117 96 119 90 117 83 118 78 112 77Z"/>
</g>`;
const monsterLabel=`
${text(100,43,'TAURINE',6.2,'#f4f1e7','style="font-family:Georgia,serif;font-weight:bold" letter-spacing="2.3"')}
${claw}
${text(100,186,'MONSTER',18,'#f2f2e9','style="font-family:Georgia,serif;font-weight:bold" letter-spacing="-.5" stroke="#c5c9c2" stroke-width=".4" paint-order="stroke" textLength="79" lengthAdjust="spacingAndGlyphs"')}
${text(100,200,'ENERGY',7.8,'#a6d82c','font-weight="bold" letter-spacing="3"')}
${text(100,220,'16 FL OZ',4.8,'#e5e5de','letter-spacing=".7"')}`;
const monster=can('monster-energy-original','Monster Energy Original',monsterLabel,{
  color:ref('black'),blackRim:true,greenTab:true,
  defs:`<linearGradient id="__ID__black"><stop stop-color="#101313"/><stop offset=".22" stop-color="#242727"/><stop offset=".52" stop-color="#101212"/><stop offset=".85" stop-color="#080a0a"/><stop offset="1" stop-color="#242828"/></linearGradient><linearGradient id="__ID__claw"><stop stop-color="#d8df35"/><stop offset=".45" stop-color="#98cc2f"/><stop offset="1" stop-color="#27a446"/></linearGradient>`,
});

function orangeSlice() {
  return `<g transform="translate(100 139) rotate(17)">
<path d="M-22 0A22 22 0 0 0 22 0Z" fill="#eda52c"/>
<path d="M-20 0A20 20 0 0 0 20 0Z" fill="#fbf1c5"/>
<path d="M-18 1A18 18 0 0 0 18 1Z" fill="#efae36"/>
${Array.from({length:6},(_,i)=>{const a=(i+1)*Math.PI/7;return `<path d="M0 0 ${Math.cos(a)*18} ${Math.sin(a)*18}" stroke="#fff0c3" stroke-width=".9"/>`;}).join('')}
<path d="M-19 0H19" stroke="#fff4d1" stroke-width="1.3"/>
</g>`;
}
const celsiusLabel=`
${text(100,39,'ORANGE',4.2,'#bd7f2d','font-weight="bold" letter-spacing=".5"')}
<g transform="translate(101 78)">
<path d="M15-20H-2C-32-20-34 20-4 22 2 23 9 21 14 17L7 10C3 13-7 13-10 7-19-7-3-11 4-11 11-11 15-15 15-20Z" fill="${ref('celsiusC')}"/>
<circle cx="-25" cy="-15" r="4.2" fill="none" stroke="#8a8e89" stroke-width="2.1"/>
</g>
${text(100,119,'CELSIUS',13.7,'#242925','font-weight="bold" textLength="53" lengthAdjust="spacingAndGlyphs"')}
${text(116,126,'LIVE FIT',4.5,'#c38a37','font-weight="bold"')}
${orangeSlice()}
${[[-8,132],[4,134],[0,129],[12,131]].map(([x,y])=>`<circle cx="${100+x}" cy="${y}" r="1.2" fill="none" stroke="#a6b3a3" stroke-width=".4"/>`).join('')}
${text(98,173,'SPARKLING',7.2,'#343b36')}
${text(83,179,'ORANGE',4.7,'#c78b34','font-weight="bold"')}
<path d="M66 184q34 6 68 0v25q-34 6-68 0Z" fill="#292c2a"/>
<path d="M66 184q7 2 11 2v25l-11-2Z" fill="#d58b31"/>
${text(104,193,'ESSENTIAL ENERGY',4.1,'#f4f3e9')}
${text(104,199,'ACCELERATES METABOLISM',3.4,'#f4f3e9')}
${text(104,204,'BURNS BODY FAT',3.7,'#f4f3e9')}
${text(81,221,'0',9,'#252d29','font-weight="bold"')}
${text(81,225,'SUGARS',2.2,'#252d29')}
${text(110,222,'12 FL OZ',3.4,'#39423c')}`;
const celsius=can('celsius-sparkling-orange','Celsius Sparkling Orange',celsiusLabel,{
  slim:true,color:ref('white'),blackRim:true,
  defs:`<linearGradient id="__ID__white"><stop stop-color="#bac3bf"/><stop offset=".22" stop-color="#f7f8f2"/><stop offset=".55" stop-color="#f1f3ed"/><stop offset="1" stop-color="#c3cbc7"/></linearGradient><linearGradient id="__ID__celsiusC" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e29728"/><stop offset=".34" stop-color="#e9b849"/><stop offset=".4" stop-color="#d6d7cf"/><stop offset="1" stop-color="#737a74"/></linearGradient>`,
});

const leaf=(x,y,scale=1,rotation=0)=>`<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})"><path d="M0 0C-14-19-5-33 0-36 10-32 16-17 0 0Z" fill="#79d7cb" stroke="#e8fff0" stroke-width=".65"/><path d="M0 0V-33M0-11l-8-6M0-18l9-6M0-25l-5-3" fill="none" stroke="#f2fff1" stroke-width=".8"/></g>`;
const strawberry=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-9-5Q-13-17 0-14 13-17 10-4L0 13Z" fill="#f32968" stroke="#ffb9cf" stroke-width=".6"/>${[[-5,-7],[3,-8],[-2,-2],[5,-1],[0,5]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx=".65" ry="1.3" fill="#ffe5df"/>`).join('')}</g>`;
const coconut=(x,y,rotation=0)=>`<g transform="translate(${x} ${y}) rotate(${rotation})"><path d="M-9-5Q-13 17 0 21 13 17 9-5Z" fill="#b85b2b" stroke="#f4b679" stroke-width=".6"/><ellipse cy="-5" rx="9" ry="6" fill="#fff5de"/><ellipse cy="-5" rx="6" ry="3.8" fill="#88d7c7"/><path d="M0-5 3-18h7" fill="none" stroke="#ffd0e9" stroke-width="1.7"/><path d="M-6 3-4 12M5 2 3 16" stroke="#efad6a" stroke-width=".7"/></g>`;
// Hand-drawn connected lettering, rotated to follow the inspected vertical mark.
const alaniScript=`<g transform="translate(105 174) rotate(-90) scale(.8 .65)" fill="none" stroke="#fffdf2" stroke-width="5.3" stroke-linecap="round" stroke-linejoin="round">
<path d="M0 9Q17-14 31-22L14 12M9 0 27-2M16 11q13-3 27-31 7-13 0-11-10 6-12 29-1 16 11 3M43 0q12-16 18-7 1 10-11 13-10 0-6-9M60-7l-4 15q4 2 12-10l8-8-6 18q3 3 11-6M82-3 76 9q1 4 11-5"/>
<path d="m88-15 1-1"/>
</g>`;
const alaniLabel=`
<path d="M66 28h68v15H66Z" fill="#ed2461"/>
${[[-1,0],[1,0]].map(([side])=>`<g transform="translate(${side<0?69:131} 0) scale(${side<0?1:-1} 1)">
${strawberry(1,60,.9)}${leaf(2,96,.67,-18)}${strawberry(0,109,.9)}${coconut(1,126,-14)}${leaf(0,170,.65,15)}${strawberry(1,183,.8)}${leaf(0,223,.8,-12)}
</g>`).join('')}
${text(100,62,'HAWAIIAN',5.6,'#fffdf1','font-weight="bold" letter-spacing=".8"')}
${text(100,70,'SHAVED ICE',5.7,'#fffdf1','font-weight="bold" letter-spacing=".35"')}
${text(100,80,'NATURAL FLAVORS',3.5,'#fffdf1','font-weight="bold"')}
${alaniScript}
<g transform="translate(118 126) rotate(-90)">${text(0,0,'NU',11,'#fffdf1','letter-spacing="3"')}</g>
${text(100,186,'ENERGY',10.8,'#f6b8d5','font-style="italic" textLength="43" lengthAdjust="spacingAndGlyphs"')}
<path d="M84 222q-12-10-5-19 8-5 13 2 5-10 13-5 7 8 1 14Z" fill="#ff8bbe"/>
<g transform="translate(102 215)" fill="#e81c69">${Array.from({length:5},(_,i)=>`<ellipse cx="0" cy="-6" rx="4" ry="8" transform="rotate(${i*72})"/>`).join('')}<circle r="3" fill="#71318b"/></g>
<path d="M66 222q34 4 68 0v10H66Z" fill="#84d8cc"/>
${text(100,228,'12 FL OZ',3.9,'#fffdf1','letter-spacing="1"')}`;
const alani=can('alani-nu-hawaiian-shaved-ice','Alani Nu Hawaiian Shaved Ice',alaniLabel,{
  slim:true,color:ref('alani'),
  defs:'<linearGradient id="__ID__alani" x1="0" y1="0" x2=".2" y2="1"><stop stop-color="#6a38ac"/><stop offset=".35" stop-color="#a850bb"/><stop offset=".72" stop-color="#ed6a9e"/><stop offset="1" stop-color="#fa2e6c"/></linearGradient>',
});

function record(slug,packageChoice,pageUrl,imageUrl,observations,svg,uncertainty) {
  return {slug,family:'energy-starter-can',packageChoice,
    references:[{pageUrl,imageUrl,inspectedAt:'2026-11-02',visuallyInspected:true,observations}],
    uncertainty:`${uncertainty} Lettering, brand marks and fine package illustrations are simplified original vector interpretations. Final aesthetic approval and native-device review pending.`,status:'needs-review',svg};
}
export const records=[
  record('monster-energy-original','US 16 fl oz / 473mL Monster Energy Original Green can; representative size selected from manufacturer-listed formats.',
    'https://www.monsterenergy.com/en-us/energy-drinks/monster-energy/original-green/',
    'https://web-assests.monsterenergy.com/mnst/86be6554-4e12-435b-b8d0-bc492e68e436.png',
    'Manufacturer can photo visually inspected: tall black 16oz can, silver lid and base rim with lime-green pull tab; spaced white TAURINE on black shoulder; large three-jagged-slash lime/yellow/green claw mark in upper-middle, angular white MONSTER near lower third, spaced lime ENERGY below; small volume text at foot. Original Green, not Zero Sugar.',monster,
    'Manufacturer photo provides the selected 16oz package. Tiny shoulder/side-panel print omitted.'),
  record('celsius-sparkling-orange','US 12 fl oz / 355mL Celsius Sparkling Orange slim can, white/silver face and black lower information band as shown by the selected retailer photo.',
    'https://www.kroger.com/p/celsius-sparkling-orange-energy-drink-can/0088939200031',
    'https://www.kroger.com/product/images/large/front/0088939200031',
    'Retailer single-can packshot visually inspected: tall slim white/silver can, dark top rim; small ORANGE at shoulder, large orange/gray C with degree symbol above black CELSIUS and small orange LIVE FIT; orange slice with bubbles, SPARKLING ORANGE label, black lower band with orange left edge; metallic silver foot. Selected image includes essential-energy/metabolism wording; tiny certification symbols omitted.',celsius,
    'Manufacturer product page and image download returned 403; retailer package used. Packaging revision date is unverified; this drawing represents the documented retailer version rather than a claim about newest packaging.'),
  record('alani-nu-hawaiian-shaved-ice','US 12 fl oz / 355mL Alani Nu Hawaiian Shaved Ice slim can; current manufacturer purple/pink/tropical package.',
    'https://www.alaninu.com/products/energy-drink-hawaiian-shaved-ice',
    'https://www.alaninu.com/cdn/shop/files/Stretch_AN-Website-12oz-PDP-HSI-01_V1.png?v=1782762260&width=1200',
    'Manufacturer front-can image visually inspected: silver-rimmed slim can with hot pink neck, purple upper field fading to pink, white HAWAIIAN SHAVED ICE near top, vertical white Alani script and small NU, pale pink ENERGY beneath, aqua tropical leaves, strawberries, coconut halves with straws, pink shaved-ice cups and hibiscus at edges/foot; aqua bottom band and volume text. Reference is the current purple/pink package rather than older pale graphics.',alani,
    'Manufacturer image selected. Tropical illustration details and tiny legal text are simplified; the small sugar/certification badge is omitted.'),
];
