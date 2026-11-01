import {wrap,shadow,ref,text} from '../style.mjs';

// Exact product-page imagery was inspected before authoring. Jamba's hero is
// overhead; its separate front thumbnail establishes the cup and white spiral.
const date='2026-11-01';
const reference=(pageUrl,imageUrl,observations)=>({pageUrl,imageUrl,inspectedAt:date,observations,visuallyInspected:true});
const prune=svg=>svg.replace(/<(linearGradient|radialGradient) id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g,(definition,tag,id)=>svg.includes(`url(#${id})`)?definition:'');
const record=(slug,family,packageChoice,references,svg,uncertainty)=>({slug,family,packageChoice,references,svg:prune(svg),uncertainty,status:'needs-review'});

const cupShape='M44 80Q100 69 156 80L139 222Q137 233 100 234T61 222Z';
const jamba=wrap('jamba-juice-mango-a-go-go','Jamba Mango-a-go-go',`${shadow(61)}
<path d="${cupShape}" fill="${ref('mango')}" stroke="#e3bf6b" stroke-width=".7"/>
<g clip-path="${ref('cupclip')}">
<path d="M45 99q55 14 110 0M50 119q50 12 100 0" fill="none" stroke="#e5ad36" stroke-opacity=".27" stroke-width="2"/>
${Array.from({length:45},(_,i)=>`<ellipse cx="${54+(i*23)%92}" cy="${97+(i*31)%129}" rx="${i%3?'.55':'.8'}" ry="${i%3?'.8':'1.1'}" fill="${i%4?'#c89637':'#fff6c8'}" opacity="${i%4?'.13':'.3'}"/>`).join('')}
<g fill="none" stroke="#fff9df" stroke-width="5.9" stroke-linecap="round" opacity=".92">
<path d="M69 130C81 164 132 160 130 142C129 125 99 126 84 137"/>
<path d="M80 163C83 189 121 184 118 173C116 164 101 166 94 171"/>
<path d="M92 189C95 205 115 201 111 195C109 191 104 192 102 194"/>
<path d="M101 208q4 11 12 6" stroke-width="3.3"/>
</g>
<path d="${cupShape}" fill="${ref('glass')}" opacity=".26"/>
<path d="M53 92 68 218" stroke="#fff" stroke-opacity=".32" stroke-width="3" stroke-linecap="round"/>
<path d="M145 98 132 217" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
</g>
<ellipse cx="100" cy="80" rx="56" ry="12" fill="#f4c64e" stroke="#f9e8b4" stroke-width="2.7"/>
<ellipse cx="100" cy="79" rx="51" ry="9" fill="${ref('mangotop')}"/>
<path d="M57 79q7-7 21-4c14 3 18-10 32-9 15 1 24 6 30 11-11 7-28 9-46 7-15 0-26 2-37-5Z" fill="#f5c541"/>
<path d="M80 78c9-14 16-11 26-14 9-3 10-12 16-8 5 4 8 14 6 18-10 9-29 10-48 4Z" fill="${ref('mangoribbon')}"/>
<path d="M80 78c13 5 31 3 43-4M57 78q9-5 21-2" fill="none" stroke="#fff1b9" stroke-opacity=".63" stroke-width="1.8"/>
<path d="M116 65 134 21q2-4 8-1t4 6l-20 43q-3 5-7 3t-3-7Z" fill="${ref('straw')}"/>
<ellipse cx="140" cy="23" rx="6.4" ry="3.4" transform="rotate(23 140 23)" fill="#f5aa0c" stroke="#ffd55c" stroke-width=".8"/>
<path d="M137 28 121 65" stroke="#ffe96b" stroke-width="1.5" stroke-opacity=".7"/>
<path d="M45 82q55 14 110 0" stroke="#fff6db" stroke-opacity=".8" stroke-width="2" fill="none"/>
<path d="M64 223q36 12 72 0" fill="none" stroke="#d5a947" stroke-width="3"/>
<path d="M66 225q34 10 68 0" fill="none" stroke="#ffe6a1" stroke-opacity=".7" stroke-width="1.4"/>
`, `<clipPath id="__ID__cupclip"><path d="${cupShape}"/></clipPath>
<linearGradient id="__ID__mango"><stop stop-color="#e7b94c"/><stop offset=".22" stop-color="#ffe38a"/><stop offset=".54" stop-color="#f7cc58"/><stop offset="1" stop-color="#dba332"/></linearGradient>
<linearGradient id="__ID__mangotop" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffdf78"/><stop offset="1" stop-color="#efbb38"/></linearGradient>
<linearGradient id="__ID__mangoribbon" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="#fff0b2"/><stop offset=".45" stop-color="#ffdc70"/><stop offset="1" stop-color="#eeb52f"/></linearGradient>
<linearGradient id="__ID__straw"><stop stop-color="#ffdd33"/><stop offset=".5" stop-color="#ffbd08"/><stop offset="1" stop-color="#ed8104"/></linearGradient>`);

const strawberry=(x,y,s=1,a=0)=>`<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M0 20C-5 18-21-4-13-11C-8-16-2-14 0-12C6-17 18-13 16-5C14 7 6 19 0 20Z" fill="${ref('berry')}"/><path d="m0-11-5-8 6 4 5-8 1 8 8-3-5 7 7 4-11-1-4 7-2-8-9 1Z" fill="#388346"/>${[[-8,-5],[-2,-5],[6,-4],[-6,2],[2,2],[9,3],[-2,9],[4,10],[1,15]].map(([a,b])=>`<ellipse cx="${a}" cy="${b}" rx=".7" ry="1.3" fill="#f8cb83" transform="rotate(-20 ${a} ${b})"/>`).join('')}</g>`;
const bottleShape='M79 43h42v13q0 11 10 23 9 11 9 24l-3 117q0 14-37 14t-37-14l-3-117q0-13 9-24 10-12 10-23Z';
const bolthouse=wrap('bolthouse-farms-strawberry-banana','Bolthouse Farms Strawberry Banana',`${shadow(53)}
<path d="${bottleShape}" fill="${ref('smoothie')}" stroke="#b77378" stroke-width=".9"/>
<g clip-path="${ref('bottleclip')}">
<path d="M75 45h50v28H75Z" fill="#e3e8de"/>
<path d="M60 56h80v86l-80 8Z" fill="#e65c8d"/>
<path d="M96 51h30l13 44-38 8Z" fill="#fff6d5"/>
<path d="M117 52c-7 14-11 29-23 38 10 4 19-2 26-13 6-11 9-21 5-25Z" fill="#f6d94f"/>
<path d="M123 53c-5 18-10 29-22 36 12 0 21-12 25-25" fill="none" stroke="#fff3a2" stroke-width="2"/>
${strawberry(73,87,.74,-19)}${strawberry(128,84,.72,14)}${strawberry(105,52,.53,-7)}${strawberry(140,135,.65,12)}
<circle cx="101" cy="76" r="12" fill="#fff9ef"/>
${text(101,73,'NO',4,'#dc4b77','font-weight="bold"')}${text(101,78,'SUGAR',4,'#dc4b77','font-weight="bold"')}${text(101,83,'ADDED',4,'#dc4b77','font-weight="bold"')}
<g transform="rotate(-5 100 117)">${text(100,116,'Bolthouse',15,'#fff7eb','font-weight="bold" font-style="italic" letter-spacing="-.7" textLength="70" lengthAdjust="spacingAndGlyphs"')}${text(104,132,'Farms',15,'#fff7eb','font-weight="bold" font-style="italic" letter-spacing="-.8"')}</g>
<path d="M59 145 140 138 140 180 60 188Z" fill="#cc426a"/>
${text(100,159,'STRAWBERRY',9,'#ffdba7','font-weight="900" textLength="67" lengthAdjust="spacingAndGlyphs" transform="rotate(-5 100 159)"')}
${text(100,171,'BANANA',9,'#ffdba7','font-weight="900" transform="rotate(-5 100 171)"')}
<path d="M70 181 132 176v10l-62 6Z" fill="#fff8ef"/>
${text(101,186,'100% JUICE SMOOTHIE',4.8,'#cf4a77','font-weight="bold" textLength="57" lengthAdjust="spacingAndGlyphs" transform="rotate(-5 101 186)"')}
${text(100,222,'450 mL (15.2 FL OZ)',4,'#ffe2d3')}
<path d="${bottleShape}" fill="${ref('shade')}" opacity=".73"/>
<path d="M68 101 70 219" stroke="#fff" stroke-opacity=".24" stroke-width="3"/><path d="M134 103 132 218" stroke="#fff" stroke-opacity=".16" stroke-width="1.7"/>
</g>
<path d="M78 44h44M79 48h42" stroke="#e8e9df" stroke-opacity=".8" stroke-width="1.7"/>
<rect x="77" y="25" width="46" height="17" rx="4" fill="${ref('cap')}"/>
<ellipse cx="100" cy="26" rx="22" ry="4.5" fill="#fc587b"/>
${Array.from({length:20},(_,i)=>`<path d="M${79+i*2.2} 29v10" stroke="${i%2?'#f88195':'#b9254c'}" stroke-opacity=".65" stroke-width=".7"/>`).join('')}
<rect x="77" y="40" width="46" height="7" rx="2" fill="#e94068"/>
<path d="M80 46h40" stroke="#f994a5" stroke-width="1.2"/>
<path d="M67 226q33 9 66 0" fill="none" stroke="#f3ada1" stroke-opacity=".5" stroke-width="1.4"/>
`, `<clipPath id="__ID__bottleclip"><path d="${bottleShape}"/></clipPath>
<linearGradient id="__ID__smoothie"><stop stop-color="#ab666a"/><stop offset=".25" stop-color="#d39187"/><stop offset=".58" stop-color="#c27f79"/><stop offset="1" stop-color="#a9626b"/></linearGradient>
<linearGradient id="__ID__berry"><stop stop-color="#c82c3a"/><stop offset=".38" stop-color="#ee4c4c"/><stop offset="1" stop-color="#b82342"/></linearGradient>
<linearGradient id="__ID__cap"><stop stop-color="#d52c56"/><stop offset=".25" stop-color="#fb5176"/><stop offset=".65" stop-color="#f33362"/><stop offset="1" stop-color="#b9234a"/></linearGradient>`);

export const records=[
 record('jamba-juice-mango-a-go-go','cafe-smoothie-cup','US Jamba Mango-a-go-go, open clear tapered cup with orange straw as shown in official front thumbnail; serving volume not specified by image.',[
 reference('https://www.jamba.com/menu/smoothies/mango-a-go-go','https://ctfassets.gotofoods.com/zqt8tllj2cy0/2wpTdxyro3vLc2jc7GndlF/b4a7ed95da704b2676807244ed0b4bcc/JAM-mango-a-go-go-thumbnail-544x544.png','Inspected exact-product front thumbnail extracted from manufacturer page: golden yellow thick smoothie, clear tapered cup, raised upper ridges and lip, white descending spiral mark, orange straw, open top with smoothie crest. No lid, ice cubes, garnish or wordmark visible.'),
 reference('https://www.jamba.com/menu/smoothies/mango-a-go-go','https://ctfassets.gotofoods.com/zqt8tllj2cy0/17tqyeqSRWivAi0fPnISiY/25550aa66cca9ea3f3ecf3a5d3e25918/746x600_Mango-a-go-go_OH.png','Inspected exact-product overhead hero: creamy mango-yellow folded/swirl surface, orange straw and clear rim; confirms top treatment and consistency. Frontal thumbnail establishes the cup geometry and branding.')
 ],jamba,'Manufacturer menu image has no serving-size annotation; volume deliberately unspecified. Perspective adapted to shared Bevi slightly elevated front view. Final aesthetic and native review pending.'),
 record('bolthouse-farms-strawberry-banana','smoothie-pet-bottle','US 450mL / 15.2 fl oz Bolthouse Farms Strawberry Banana juice smoothie, pink label and red screw cap.',[
 reference('https://www.bolthouse.com/product/strawberry-banana/','https://www.bolthouse.com/wp-content/uploads/sites/4/2016/01/071464270407_bhf_us_bev_15_pi_blnd_sb_front_520x720.png-260x360.png','Inspected manufacturer front image: narrow PET bottle with round shoulders, ribbed red/pink cap and tamper ring, pink sleeve, strawberries and banana at shoulder, white NO SUGAR ADDED circle, white two-line Bolthouse Farms script, darker pink STRAWBERRY BANANA band, angled white 100% JUICE SMOOTHIE stripe, muted strawberry smoothie at base. Bottom visibly reads 450mL / 15.2 FL OZ.')
 ],bolthouse,'Representative US single-serve package selected because catalog lacks size. Manufacturer source is a small image; typography and fruit motifs are simplified while retaining observed layout. Final aesthetic and native review pending.')
];
