import {wrap, shadow, ref, text} from '../style.mjs';

// Current full-name packaging, individually checked against US 12oz can photos.
const shape = 'M61 41Q100 32 139 41L145 58V220Q145 233 100 233T55 220V58Z';
const pine = (x,y,h,fill) => `<path d="M${x} ${y}l${-h*.22} ${h*.36}h${h*.11}l${-h*.23} ${h*.28}h${h*.15}l${-h*.26} ${h*.25}h${h*.34}v${h*.11}h${h*.06}v${-h*.11}h${h*.34}l${-h*.26} ${-h*.25}h${h*.15}l${-h*.23} ${-h*.28}h${h*.11}Z" fill="${fill}"/>`;

function wordmark(diet) {
  const letters = stroke => `${text(109,107,'MOUNTAIN',26,'#034c2d',`font-weight="bold" textLength="84" lengthAdjust="spacingAndGlyphs" ${stroke}`)}${text(109,149,'DEW',50,'#df1737',`font-weight="bold" letter-spacing="-2" textLength="84" lengthAdjust="spacingAndGlyphs" ${stroke}`)}`;
  return `<g transform="rotate(-13 100 120) skewX(-3)">
${letters('stroke="#073e29" stroke-width="7" stroke-linejoin="round" paint-order="stroke"')}
${letters('stroke="#f5d930" stroke-width="5" stroke-linejoin="round" paint-order="stroke"')}
${letters('stroke="#fffdf0" stroke-width="3" stroke-linejoin="round" paint-order="stroke"')}
${diet ? text(96,82,'DIET',15,'#d71a35','font-weight="bold" stroke="#fffdf0" stroke-width="2.6" paint-order="stroke" textLength="35" lengthAdjust="spacingAndGlyphs"') : ''}
</g>`;
}

function landscape(diet) {
  return `<path d="M49 215V182l17-23 14 24 14-44 18 31 10-15 30 57v29H49Z" fill="${diet ? '#8d9e96' : '#25732d'}"/>
<path d="m79 184 15-45 18 31-14-11-4 8-7-5Z" fill="${diet ? '#f2f3ed' : '#d7e3ad'}"/>
<path d="M48 209 65 177l18 20 13-14 17 26 17-16 22 19v25H48Z" fill="${diet ? '#d4d9d4' : '#1d692e'}"/>
<path d="M116 177q-18 15-2 24t-8 15q-14 4-5 16h18q-18-11 0-17t2-18q-16-9 2-18Z" fill="#43b9a9" opacity=".85"/>
${[[-1,191,38],[15,203,25],[30,183,46],[47,201,31],[66,190,44],[83,207,27]].map(([dx,y,h])=>pine(60+dx,y,h,'#005538')).join('')}
${Array.from({length:12},(_,i)=>pine(55+i*8,214+(i%3)*3,18+(i%4)*3,'#003d29')).join('')}`;
}

function lime(x,y,r,rotation=0) {
  return `<g transform="translate(${x} ${y}) rotate(${rotation})"><circle r="${r}" fill="#3b9d24"/><circle r="${r-1.5}" fill="#e9ed97"/><circle r="${r-3}" fill="#b5d54b"/>${Array.from({length:7},(_,i)=>`<path d="M0 0 ${Math.cos(i*Math.PI/3.5)*(r-3)} ${Math.sin(i*Math.PI/3.5)*(r-3)}" stroke="#f8f5bb" stroke-width=".8"/>`).join('')}<circle r="1.2" fill="#f8f5bb"/></g>`;
}

function tropical() {
  return `<path d="M51 170q18-28 39-19t24-2q18-18 37 0v74H51Z" fill="#017d78"/>
<path d="M49 184q20-27 49-19-31 1-30 20 5-10 17-8-13 7-9 14 25 12 57-6-12 20-49 19-26-1-35-20Z" fill="#e8f6d6"/>
<path d="M51 203q28 13 49 0t50-4v5q-25-4-49 6t-50-1Z" fill="#56c9b4"/>
<path d="M51 216q26-4 49 0t50-3v24H51Z" fill="#eccb20"/>
<path d="M51 215q26-4 49 0t50-3" fill="none" stroke="#f9f8d1" stroke-width="2.5"/>
${lime(66,226,15,-20)}${lime(63,73,10,25)}
<g transform="translate(116 178) rotate(-9)">
${text(0,0,'Baja',12,'#fffce3','font-weight="bold" font-style="italic" stroke="#063f32" stroke-width="2.5" paint-order="stroke"')}
${text(0,13,'Blast',15,'#fffce3','font-weight="bold" font-style="italic" stroke="#063f32" stroke-width="2.5" paint-order="stroke"')}
${text(0,23,'TROPICAL LIME',5.1,'#fffce3','font-weight="bold" stroke="#063f32" stroke-width="1.5" paint-order="stroke"')}
</g>`;
}

function draw(slug, diet, baja) {
  const title = baja ? 'Mountain Dew Baja Blast' : diet ? 'Diet Mountain Dew' : 'Mountain Dew';
  const label = `
<path d="M63 42 93 103 87 42ZM97 40 104 103 116 40ZM124 42 111 108 141 43Z" fill="${diet ? '#f7f6ed' : '#fffce6'}"/>
<path d="M73 42 96 102 91 42ZM113 40 107 100 123 41Z" fill="#e4c821"/>
<path d="M57 44 85 104 78 46ZM103 39 102 98 109 40ZM137 43 115 105 145 64Z" fill="${baja ? '#015b52' : '#005a2b'}"/>
${baja ? tropical() : landscape(diet)}
${wordmark(diet)}
${baja ? '' : text(100,220,diet ? 'DIET DEW' : '12 FL OZ',4.8,diet ? '#f2f4e8' : '#d9e8a9','font-weight="bold" letter-spacing=".6"')}`;
  return wrap(slug,title,`${shadow(58)}
<path d="${shape}" fill="${ref('bodycolor')}"/>
<g clip-path="${ref('bodyclip')}">${label}
<path d="${shape}" fill="${ref('shade')}"/>
<path d="M65 62V213" fill="none" stroke="#fff" stroke-opacity=".17" stroke-width="3.1"/>
<path d="M138 62V213" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="1.3"/>
${Array.from({length:22},(_,i)=>`<ellipse cx="${62+i*19%78}" cy="${61+i*37%156}" rx="${i%3?.55:1}" ry="${i%3?.9:1.5}" fill="#fff" opacity=".19"/>`).join('')}
</g>
<ellipse cx="100" cy="41" rx="39" ry="8" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.1"/>
<ellipse cx="100" cy="41" rx="34" ry="5.5" fill="none" stroke="#8d9892" stroke-width=".8"/>
<ellipse cx="105" cy="42" rx="8" ry="3.5" fill="#657169"/>
<path d="M93 39h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="#e6e8de" stroke-width="2.4"/>
<path d="M58 226q42 12 84 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/>
<path d="M61 230q39 7 78 0" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>
`, `<clipPath id="__ID__bodyclip"><path d="${shape}"/></clipPath>
<linearGradient id="__ID__bodycolor"><stop stop-color="${diet ? '#a5acaa' : baja ? '#018e82' : '#298624'}"/><stop offset=".23" stop-color="${diet ? '#f1f3ef' : baja ? '#15b1a3' : '#5dc32d'}"/><stop offset=".6" stop-color="${diet ? '#c6cdca' : baja ? '#009b8c' : '#3baf22'}"/><stop offset="1" stop-color="${diet ? '#a0aaa5' : baja ? '#006d66' : '#086627'}"/></linearGradient>`);
}

const source = (slug,upc,observations,diet=false,baja=false) => ({
  slug, family:'mountain-dew-can',
  packageChoice:`US 12 fl oz / 355mL ${baja ? 'Mountain Dew Baja Blast tropical lime' : diet ? 'Diet Mountain Dew' : 'Mountain Dew Original'} can, current full-name logo and illustrated landscape; representative US size for the size-unspecified catalog row.`,
  references:[{
    pageUrl:`https://www.kroger.com/p/${diet ? 'diet-' : ''}mountain-dew-${baja ? 'baja-blast-' : ''}soda-cans/${upc}`,
    imageUrl:`https://www.kroger.com/product/images/large/front/${upc}`,
    inspectedAt:'2026-11-02',visuallyInspected:true,observations,
  }],
  uncertainty:'Manufacturer product pages consulted first; direct manufacturer image retrieval was unavailable (403/404). Each current retailer can photo visually inspected independently. Full-name lettering, landscape and flavor artwork are simplified original vector interpretations; condensation and tiny side-panel print simplified. Final aesthetic approval and native-device review pending.',
  status:'needs-review',svg:draw(slug,diet,baja),
});

export const records = [
  source('mountain-dew','0001200080996','Inspected retailer image: green 12oz can with new full MOUNTAIN over red DEW wordmark, slanted upward, white/yellow/dark-green outline; white/green/yellow shoulder rays, mountain scene and dark pine forest at foot, teal water detail, silver lid and foot. Uses full-name package rather than legacy MTN DEW.'),
  source('diet-mountain-dew','0001200080997','Separately inspected Diet image: silver/gray can, red DIET above full green MOUNTAIN/red DEW outlined wordmark; white/green/yellow shoulder rays, snowy gray mountains and dark-green pine forest along bottom; small DIETDEW near foot and silver rims. Main face is silver, not Original green.',true),
  source('mountain-dew-baja-blast','0001200013032','Separately inspected Baja Blast image: turquoise/teal 12oz can, green MOUNTAIN/red DEW full-name outlined wordmark, yellow/white shoulder rays, stylized white surf curl, lime slices near shoulder and bottom, yellow base strip; small italic Baja Blast and TROPICAL LIME on lower right, silver rims. Tropical lime Original, not Zero Sugar.',false,true),
];
