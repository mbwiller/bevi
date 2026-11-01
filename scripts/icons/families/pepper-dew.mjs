import {wrap,shadow,ref,text} from '../style.mjs';
const prune=svg=>svg.replace(/<(linearGradient|radialGradient) id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g,(definition,tag,id)=>svg.includes(`url(#${id})`)?definition:'');

// Six independently inspected US 12oz references; shared v1 lighting and can geometry.
function can(slug,title,label,color,{sleek=false,defs=''}={}){
 const l=sleek?62:55,r=200-l,t=sleek?26:41,rx=100-l-6;
 const body=`M${l+6} ${t}Q100 ${t-9} ${r-6} ${t}L${r} ${t+17}V220Q${r} 233 100 233T${l} 220V${t+17}Z`;
 return wrap(slug,title,`${shadow(sleek?50:58)}<path d="${body}" fill="${color}"/><g clip-path="${ref('bodyclip')}">${label}<path d="${body}" fill="${ref('shade')}"/><path d="M${l+9} ${t+22}V215" stroke="#fff" stroke-opacity=".16" stroke-width="3"/><path d="M${l+13} ${t+23}V212" stroke="#fff" stroke-opacity=".08" stroke-width="1"/></g><ellipse cx="100" cy="${t}" rx="${rx}" ry="8" fill="${ref('metal')}" stroke="#9ca7a4" stroke-width="1.2"/><ellipse cx="100" cy="${t}" rx="${rx-5}" ry="5.5" fill="none" stroke="#8d9892" stroke-width=".8"/><ellipse cx="104" cy="${t+1}" rx="8" ry="3.5" fill="#657169"/><path d="M93 ${t-2}h10q6 0 5 4t-8 3h-6q-6-1-1-7" fill="none" stroke="#e6e8de" stroke-width="2.4"/><path d="M${l+3} 226q${(r-l-6)/2} 12 ${r-l-6} 0" fill="none" stroke="${ref('metal')}" stroke-width="4"/><path d="M${l+6} 230q${(r-l-12)/2} 7 ${r-l-12} 0" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>`,`<clipPath id="__ID__bodyclip"><path d="${body}"/></clipPath>${defs}`);
}

function pepperMark(zero=false){
 // The raised P and offset Dr preserve the distinctive two-level wordmark.
 const logo=`<g transform="translate(100 115) rotate(-12) scale(.83 .96)">
 ${zero?'':`<ellipse cx="0" cy="0" rx="47" ry="39" fill="#ba1631" stroke="#681127" stroke-width="3"/><path d="M-45 1Q-44-37 24-37M-23 37Q39 34 46-11" fill="none" stroke="#d92f3a" stroke-width="2.3"/>`}
 <path d="M-36 28V-23Q-34-35-21-35C4-35 4-5-20 0H-25v28Z M-24-8h3q14-3 14-13t-17-8Z" fill="#fffaf3" fill-rule="evenodd" ${zero?'':'stroke="#22211e" stroke-width=".6"'}/>
 ${text(10,-9,'Dr',31,'#fffaf3','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" letter-spacing="-2" textLength="38" lengthAdjust="spacingAndGlyphs"')}
 ${text(8,18,'epper',26,'#fffaf3','style="font-family:Georgia,serif;font-weight:bold;font-style:italic" letter-spacing="-1.8" textLength="68" lengthAdjust="spacingAndGlyphs"')}
 ${text(23,28,'Est.1885',7.3,'#fffaf3','font-weight="bold" font-style="italic"')}
 <path d="M-42 9Q-50-18-26-34M-28 34Q34 43 45-9Q48-21 34-29" fill="none" stroke="#fffaf3" stroke-width="1.8" stroke-linecap="round"/>
 </g>`;
 return logo;
}

function pepper(slug,variant){
 const diet=variant==='diet',zero=variant==='zero';
 const color=diet?'#efefec':'#8c1e2e';
 const labels=zero?`<path d="M55 55Q83 54 101 75Q62 84 61 117Q64 156 127 147Q145 193 146 235H54Z" fill="#1e211f"/>${pepperMark(true)}${text(100,185,'zero',31,'#fffaf3','font-weight="bold" letter-spacing="-.5" textLength="70" lengthAdjust="spacingAndGlyphs"')}${text(100,205,'SUGAR',20,'#fffaf3','font-weight="bold" letter-spacing=".2" textLength="70" lengthAdjust="spacingAndGlyphs"')}`:
 `${pepperMark()}<g transform="rotate(-12 102 177)"><ellipse cx="126" cy="181" rx="16" ry="13" fill="none" stroke="${diet?'#971b39':'#b82a3e'}" stroke-width="1.6"/><ellipse cx="134" cy="175" rx="8" ry="12" fill="none" stroke="${diet?'#971b39':'#b82a3e'}" stroke-width="1.2"/><ellipse cx="92" cy="176" rx="26" ry="21" fill="${diet?'#efefec':'#a12635'}" stroke="${diet?'#a42240':'#661c28'}" stroke-width="1.8"/>${text(92,184,diet?'Diet':'23',diet?22:25,diet?'#8b2135':'#741d2a','font-weight="bold" font-style="italic" letter-spacing="-1.3"')}${diet?'':`<ellipse cx="92" cy="176" rx="22" ry="17" fill="none" stroke="#bd3343" stroke-width=".8"/>`}</g>`;
 return can(slug,diet?'Diet Dr Pepper':zero?'Dr Pepper Zero Sugar':'Dr Pepper',labels,color);
}

const tree=(x,y,h,w)=>`<path d="M${x} ${y-h}l${-w*.22} ${h*.22}h${w*.13}l${-w*.27} ${h*.24}h${w*.17}l${-w*.33} ${h*.25}h${w*.25}l${-w*.33} ${h*.29}h${w*1.2}l${-w*.33} ${-h*.29}h${w*.25}l${-w*.33} ${-h*.25}h${w*.17}l${-w*.27} ${-h*.24}h${w*.13}Z"/>`;
function dewMark(variant){
 const ink=variant==='baja'?'#057368':'#006136';
 const letters=[
 ['M',16,'M0 32V0h5l3 16L11 0h5v32h-5V14L8 27 5 14v18Z'],
 ['O',12,'M4 0h4q4 0 4 5v22q0 5-4 5H4q-4 0-4-5V5q0-5 4-5Zm1 6v20h2V6Z'],
 ['U',12,'M0 0h5v25q1 3 2 0V0h5v27q0 5-6 5t-6-5Z'],
 ['N',13,'M0 32V0h5l3 13V0h5v32H8L5 18v14Z'],
 ['T',12,'M0 0h12v6H9v26H3V6H0Z'],
 ['A',13,'M0 32 4 0h5l4 32H8l-.4-7H5.4L5 32Zm6-13h1L6.5 8Z'],
 ['I',5,'M0 0h5v32H0Z'],
 ['N',13,'M0 32V0h5l3 13V0h5v32H8L5 18v14Z']
 ];let cursor=0;
 const mountain=letters.map(([,w,d])=>{const p=`<path d="${d}" transform="translate(${cursor} 0)"/>`;cursor+=w+1;return p;}).join('');
 return `<g transform="translate(100 126) rotate(-15)">
 <path d="M-51-28h14v-6h17v7h67v70H-31V29h-20Z" fill="#242b28" transform="translate(0 7)"/>
 <path d="M-51-28h14v-6h17v7h67v70H-31V29h-20Z" fill="#fbf8dd" stroke="${ink}" stroke-width="7"/>
 <path d="M-51-28h14v-6h17v7h67v70H-31V29h-20Z" fill="none" stroke="#e6d21d" stroke-width="2.3"/>
 <g fill="${ink}" fill-rule="evenodd" transform="translate(-47 -25) scale(.9 .86)">${mountain}</g>
 <g fill="#df1534" fill-rule="evenodd" transform="translate(-28 4) scale(.68 .86)">
 <path d="M0 0h14q14 0 14 11v22q0 11-14 11H0Zm10 9v26h4q4 0 4-5V14q0-5-4-5Z"/>
 <path d="M45 0q13 0 13 11v14H42v8q0 4 4 4t4-5h8q0 12-13 12-13 0-13-12V13Q32 0 45 0Zm-3 17h7v-5q0-4-3-4-4 0-4 4Z"/>
 <path d="M61 0h9l2 26 6-26h8l3 26 3-26h9l-7 44H83l-2-25-5 25H65Z"/>
 </g>
 </g>`;
}

function dew(slug,variant){
 const diet=variant==='diet',baja=variant==='baja';
 const bodyColor=diet?ref('metal'):baja?'#119d92':'#64c62a';
 const sun=`<path d="M77 152 53 36H63ZM85 144 77 36H89ZM96 145 109 36H124ZM109 149 150 43V72Z" fill="${diet?'#f3f4ee':'#f4f4df'}"/><path d="M99 139 122 36h9Z" fill="${diet?'#00633d':'#ded019'}"/><path d="M74 146 53 43h4Z" fill="#e6d51b"/>`;
 const landscape=baja?`<path d="M53 208Q76 200 93 208Q107 211 128 204L149 204V237H53Z" fill="#e2d51b"/><path d="M53 207Q59 197 67 207Q76 209 80 207Q86 201 97 208Q105 210 111 208Q116 202 125 206Q134 211 143 204" stroke="#f7f8e9" fill="none" stroke-width="4"/><g transform="translate(58 238) rotate(-24)"><ellipse cx="0" cy="0" rx="30" ry="20" fill="#80b92b"/><ellipse cx="0" cy="0" rx="25" ry="15" fill="#e0e4a2"/><path d="M-20-4-5-12-2-1Zm17-8 15 0L2-1Zm18 2 8 8L4 0ZM21 1 9 11 4 3Z" fill="#91b839"/></g>`:
 `<path d="M54 220 74 166 90 190 111 166 147 213V235H54Z" fill="${diet?'#adb6b0':'#2b9b5a'}"/><path d="m74 166-3 20 6-5 5 8 8 1ZM111 166l-14 27 13-9 6 12 12 4Z" fill="${diet?'#e2e6e0':'#85c969'}"/><g fill="#005837">${Array.from({length:25},(_,i)=>tree(54+i*4,235,17+(i*7)%24,3.6)).join('')}</g>`;
 // The photographed upper-left motif is an asymmetric curled crest, not a generic radial flower.
 const crest=baja?`<g transform="translate(53 54) scale(.82 .72)"><path d="M0 30C4 24 3 16 9 11C13 4 18 5 21 12C26 17 28 11 33 17L39 23C43 19 46 14 45 6C49 4 51 7 49 12C54 11 55 15 55 20C60 20 62 27 65 30C71 37 68 42 63 39L59 34C57 36 61 43 57 45C51 47 46 40 42 39C37 36 34 40 29 35C24 31 22 35 17 32C12 28 11 35 7 34Z" fill="#c7e78c"/><path d="M0 27C4 21 3 13 9 8C13 1 18 2 21 9C26 14 28 8 33 14L39 20C43 16 46 11 45 3C49 1 51 4 49 9C54 8 55 12 55 17C60 17 62 24 65 27C71 34 68 39 63 36L59 31C57 33 61 40 57 42C51 44 46 37 42 36C37 33 34 37 29 32C24 28 22 32 17 29C12 25 11 32 7 31Z" fill="#fffef0"/><path d="M9 10q10-8 7 4l-3 5q2-8-4-9M27 15q8 4 8 15-6-7-8-15M49 14q8 1 5 10l-3-2q4-3-2-8M61 28q8 5 4 7" fill="#d9edb7"/></g>`:'';
 const extra=diet?`<g transform="rotate(-15 96 83)"><path d="M75 64h43v23H75Z" fill="#f4f4ed"/>${text(97,83,'DIET',19,'#d91534','font-weight="900" letter-spacing="-.7"')}</g>${text(72,218,'DIET DEW',5.7,'#d9e4d4','font-weight="bold"')}`:baja?`<g transform="translate(119 181) rotate(-5)"><path d="M-27-10q16-5 31-2 12-6 17 4l-5 27h-45Z" fill="#172e29" stroke="#05766e" stroke-width="2"/><path d="M3-13q-20-11-7-13 22 0 18 15" stroke="#a9c9b5" stroke-width="2" fill="none"/>${text(7,-1,'Baja',9.5,'#fbf8e3','font-style="italic" font-weight="bold"')}${text(-1,13,'Blast',19,'#f7f2c2','font-style="italic" font-weight="900" letter-spacing="-.6"')}${text(0,22,'TROPICAL LIME',6,'#fffbea','font-weight="bold"')}</g>`:'';
 return can(slug,baja?'Mountain Dew Baja Blast':diet?'Diet Mountain Dew':'Mountain Dew',`${sun}${landscape}${crest}${dewMark(variant)}${extra}`,bodyColor);
}

const product=(slug,packageChoice,pageUrl,imageUrl,observations,svg)=>({slug,family:'pepper-dew-can',packageChoice,references:[{pageUrl,imageUrl,inspectedAt:'2026-10-31',observations,visuallyInspected:true}],uncertainty:'Representative US 12oz package selected because the catalog does not specify size. References are the exact distributor packshots accessed on the inspection date; concurrent regional packaging may differ. Complex brand lettering and fine label art are simplified vector interpretations. Final aesthetic and native review pending.',status:'needs-review',svg});
export const records=[
 product("dr-pepper","US 12 fl oz Original Dr Pepper can; red oval-and-23-medallion package pictured by PepsiCo Partners.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Dr-Pepper-(2-12-Packs)/p/1-HYK-44768","https://www.pepsicopartners.com/medias/1200Wx1200H-1-HYK-44768.jpeg?context=bWFzdGVyfHJvb3R8NzQ0OTF8aW1hZ2UvanBlZ3xhREUyTDJneVlpOHhNVGN5TXpnMU1qUTRNRFUwTWk4eE1qQXdWM2d4TWpBd1NGOHhMVWhaU3kwME5EYzJPQzVxY0dWbnw4ZmQzYzY0M2NjNDIwMzEwM2I3ODU4MDU2MzJkMWY5YjViZTM2MmM1MWNiMTQwY2FkOGI4NmM5OWUxNDdkM2Fh","Individually inspected 1200px distributor image: deep red standard can, red oval, raised initial P with white offset Dr/Pepper lettering, white swoosh, Est.1885, lower tonal 23 roundel and rings.",pepper('dr-pepper','original')),
 product("diet-dr-pepper","US 12 fl oz Diet Dr Pepper can; white/silver package with red wordmark oval.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Diet-Dr-Pepper-(2-12-Packs)/p/1-HYK-44769","https://www.pepsicopartners.com/medias/1200Wx1200H-1-HYK-44769.jpeg?context=bWFzdGVyfHJvb3R8ODA0MjF8aW1hZ2UvanBlZ3xhR014TDJnellTOHhNVGN5TXpnMU16TXpNalV4TUM4eE1qQXdWM2d4TWpBd1NGOHhMVWhaU3kwME5EYzJPUzVxY0dWbnw3MTdlZjg2NTRjODk5NjU0OTJhNDMxM2Q0NzY2YzgzODdkYzg0ZTU2OGJjY2QyMTExNzE5NDdhYzBiYWYxNTI5","Individually inspected 1200px distributor image: silver-white standard can with red oval, white Dr Pepper lettering and swoosh, lower white Diet medallion outlined in red and red decorative rings.",pepper('diet-dr-pepper','diet')),
 product("dr-pepper-zero-sugar","US 12 fl oz Dr Pepper Zero Sugar Original can; black lower body and burgundy upper sweep.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Dr-Pepper-Zero-Sugar/p/1-Y34T4-1","https://www.pepsicopartners.com/medias/1200Wx1200H-1-Y34T4-1.jpeg?context=bWFzdGVyfHJvb3R8NjA2Nzl8aW1hZ2UvanBlZ3xhRGc1TDJoaU1DOHhNVGN5TXprNE5UWTBPVFk1TkM4eE1qQXdWM2d4TWpBd1NGOHhMVmt6TkZRMExURXVhbkJsWnd8ZDNlZjgwZmZmMzNkYzg1MjhhZDQ3Mjg0MTRkNWY2MWY0OTE4NDhkYjc5MjcwMTViNjM5MThmZTA5OGVkNzIxYg","Individually inspected 1200px distributor image: standard can, burgundy upper/right area curving across black body, unshadowed white Dr Pepper mark, prominent lowercase zero and uppercase SUGAR stacked beneath.",pepper('dr-pepper-zero-sugar','zero')),
 product("mountain-dew","US 12 fl oz Mountain Dew Original can; current full-name Mountain Dew package.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Mountain-Dew/p/1-HYK-24770","https://www.pepsicopartners.com/medias/1200Wx1200H-1-HYK-24770.jpg?context=bWFzdGVyfHJvb3R8ODk3Mzl8aW1hZ2UvanBlZ3xhREprTDJneE1TOHhNVGN4TnpreU9UVTVPVEF3Tmk4eE1qQXdWM2d4TWpBd1NGOHhMVWhaU3kweU5EYzNNQzVxY0djfDI0NTQxYTI5OWFmZjVkNjMzMTgwODdlY2Y1MzkxZGRlMjlkMTEwYTY0ODQ1M2U4MTJkZmM1ZWY2Y2MwZjJhYzk","Individually inspected 1200px manufacturer-distributor image: green can, silver and yellow rays behind oversized tilted full-name green Mountain/red Dew mark with white/yellow/green keylines, mountain shapes and dark green forest at base.",dew('mountain-dew','original')),
 product("diet-mountain-dew","US 12 fl oz Diet Mountain Dew can; current full-name silver/green package.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Diet-Mountain-Dew-(2-12-Packs)/p/1-HYK-45462","https://www.pepsicopartners.com/medias/1200Wx1200H-1-HYK-45462.jpg?context=bWFzdGVyfHJvb3R8OTIwNzR8aW1hZ2UvanBlZ3xhRE16TDJnNE5TOHhNVGN5TkRnNU1UQTVOVEEzTUM4eE1qQXdWM2d4TWpBd1NGOHhMVWhaU3kwME5UUTJNaTVxY0djfDJmZWYyNzZjNzgxYTNhYTU4YmQ5MGIzY2RjZTM3NzQ2NzI5N2I4Yjk5MGFlYjExMGMyODVkZDBiMDhlMmQ1Zjg","Individually inspected 1200px manufacturer-distributor image: silver standard can, white and green rays, red DIET above tilted full-name green Mountain/red Dew mark, gray mountain backdrop, dark green forest and DIET DEW low on body.",dew('diet-mountain-dew','diet')),
 product("mountain-dew-baja-blast","US 12 fl oz Mountain Dew Baja Blast can; current full-name teal/yellow Tropical Lime package.","https://www.pepsicopartners.com/pepsico/en/USD/BEVERAGES/Soft-Drinks/Mountain-Dew-Baja-Blast/p/1-RZWDB-2","https://www.pepsicopartners.com/medias/1200Wx1200H-1-RZWDB-2.jpeg?context=bWFzdGVyfHJvb3R8MTAzNDkwfGltYWdlL2pwZWd8YURGbUwyZzVZUzh4TVRjeU5EazJORGsxTkRFME1pOHhNakF3VjNneE1qQXdTRjh4TFZKYVYwUkNMVEl1YW5CbFp3fGEzNTAzMzU4NDAyZGE2ZmQ3ODc5ODdlNjFjYWM5N2VhOTY1YzIyMDQ1ZDQ1YzM0Y2RlMDgzMDVlMDYzNjdmMGI","Individually inspected 1200px manufacturer-distributor image: teal standard can, white/yellow rays, asymmetric white curled crest with pale-green underside at upper left, tilted full-name green Mountain/red Dew mark, Baja Blast wave badge at lower right, white surf and yellow lower band with partial lime at base.",dew('mountain-dew-baja-blast','baja')),
].map(record=>({...record,svg:prune(record.svg)}));
