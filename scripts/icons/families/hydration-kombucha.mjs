import {wrap,shadow,ref,text} from '../style.mjs';

// Both silhouettes follow their inspected manufacturer photographs; the wide,
// sculpted 28oz PET sports bottle and narrow 16oz glass bottle are not shared.
const date='2026-11-01';
const prune=svg=>svg.replace(/<(linearGradient|radialGradient) id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g,(definition,tag,id)=>svg.includes(`url(#${id})`)?definition:'');
const source=(pageUrl,imageUrl,observations)=>({pageUrl,imageUrl,inspectedAt:date,visuallyInspected:true,observations});
const flutes=(x,y,n,step,h,color,opacity=.5)=>Array.from({length:n},(_,i)=>`<path d="M${x+i*step} ${y}v${h}" stroke="${color}" stroke-opacity="${opacity}" stroke-width=".65"/>`).join('');

const gatoradeShape='M82 42h36v8q0 3 6 6c13 7 20 19 20 33v9q0 4-3 5 5 2 5 7v12q-3 5-3 11l-4 20q-2 10 1 19l4 20q-2 5 0 10l2 10Q146 218 141 220Q142 223 145 225V230Q145 236 100 236T55 230V225Q58 223 59 220Q54 218 54 212l2-10q2-5 0-10l4-20q3-9 1-19l-4-20q0-6-3-11v-12q0-5 5-7-3-1-3-5v-9c0-14 7-26 20-33q6-3 6-6Z';
const gatoradeLabel=`<path d="M52 105q48-8 96 0v111q-48 6-96 0Z" fill="${ref('sportlabel')}"/>
<path d="m77 112 39-1-8 12 27-6-3 27-20 12-29 60H71l16-49-22 9 2-31-2-8Z" fill="#bfcf16"/>
<path d="M54 105q46-5 92 0v11q-46-5-92 0Z" fill="#30393b"/>
${text(100,111.7,'REHYDRATE. REPLENISH. REFUEL.',4.2,'#f8f8f2','font-weight="bold" textLength="76" lengthAdjust="spacingAndGlyphs"')}
<g opacity=".12" stroke="#414b48" fill="none" stroke-width="1.4"><path d="M54 123q46 5 92 0M57 143q43 5 86 0M60 159q40 5 80 0M58 177q42 5 84 0M55 199q45 5 90 0"/></g>
${text(100,157,'G',58,'#fff','font-weight="bold" stroke="#151a17" stroke-width="1.8" paint-order="stroke"')}
<path d="m111 126-12 5-8 13 5-2-5 13 20-21-7 3Z" fill="#ff6c0c" stroke="#131916" stroke-width="1.2"/>
<path d="m105 131-6 6 3-1-9 15 17-17-7 3Z" fill="#ef2636"/>
${text(113,177,'GATORADE',5.1,'#26322d','font-weight="bold"')}${text(113,184,'THIRST',7,'#26322d','font-weight="bold"')}${text(113,191,'QUENCHER',6.3,'#26322d','font-weight="bold"')}
<rect x="82" y="198" width="50" height="10" rx="1.8" fill="#bccf14"/>
${text(107,205.2,'LEMON LIME',5.8,'#fffdf0','font-weight="bold" letter-spacing=".2"')}
${text(100,216,'28 FL OZ / 828 mL',4.4,'#1e2924','font-weight="bold"')}`;

const gatorade=wrap('gatorade-lemon-lime','Gatorade Lemon Lime',`${shadow(52)}
<path d="${gatoradeShape}" fill="${ref('lemonlime')}" stroke="#8b9a29" stroke-width=".8"/>
<g clip-path="${ref('sportclip')}">
<path d="M70 78q20-13 55-17M60 97q30 4 79 0" stroke="#d7e55a" stroke-opacity=".5" stroke-width="2" fill="none"/>
<path d="M61 96V84q0-6 4-9l3 18Zm63-25q9 6 12 16l-7-1Z" fill="#f7ffa0" opacity=".28"/>
<path d="M80 95q10-9 21-10l5 9" fill="none" stroke="#aabb23" stroke-width="2" stroke-opacity=".45"/>
${gatoradeLabel}<path d="${gatoradeShape}" fill="${ref('shade')}"/>
<path d="M63 106v23q5 18 3 29M62 184l-2 16v10" fill="none" stroke="#fff" stroke-opacity=".23" stroke-width="2.5"/>
<path d="M73 64q-13 12-13 27" fill="none" stroke="#f8ffb9" stroke-opacity=".47" stroke-width="2.6"/>
<path d="M59 226q41 7 82 0M58 229q42 6 84 0" fill="none" stroke="#f1f788" stroke-opacity=".45" stroke-width="1.2"/>
</g>
<path d="M81 45q19 4 38 0M82 50q18 4 36 0" fill="none" stroke="#879b22" stroke-width="1.6"/>
<path d="M79 23q21-6 42 0l1 19q-22 5-44 0Z" fill="${ref('orange-cap')}" stroke="#d76510" stroke-width=".6"/>
<ellipse cx="100" cy="23" rx="21" ry="4" fill="#ff922a"/>
${flutes(81,25,20,2,11,'#ffb45a',.62)}
<path d="M79 38q21 4 42 0M79 41q21 4 42 0" fill="none" stroke="#e46b0b" stroke-width="1"/>
<path d="M82 25v10" stroke="#ffd08a" stroke-opacity=".65" stroke-width="1.3"/>
`, `<clipPath id="__ID__sportclip"><path d="${gatoradeShape}"/></clipPath>
<linearGradient id="__ID__lemonlime"><stop stop-color="#91a91c"/><stop offset=".2" stop-color="#dbe958"/><stop offset=".55" stop-color="#c9dc2e"/><stop offset=".85" stop-color="#afc424"/><stop offset="1" stop-color="#91a51c"/></linearGradient>
<linearGradient id="__ID__sportlabel"><stop stop-color="#8e9d9d"/><stop offset=".22" stop-color="#d9e0dd"/><stop offset=".55" stop-color="#bac6c6"/><stop offset=".86" stop-color="#819291"/><stop offset="1" stop-color="#acb9b5"/></linearGradient>
<linearGradient id="__ID__orange-cap"><stop stop-color="#df6006"/><stop offset=".25" stop-color="#ff9635"/><stop offset=".62" stop-color="#ff760b"/><stop offset="1" stop-color="#d85805"/></linearGradient>`);

const kombuchaShape='M82 43h36v10c4 8 15 9 18 29 2 13 1 27 1 42v98q0 14-37 14t-37-14v-98c0-15-1-29 1-42 3-20 14-21 18-29Z';
const lotus=`<g transform="translate(100 166) scale(.85)">${Array.from({length:8},(_,i)=>`<path d="M0-3C-5-7-5-13 0-18C5-13 5-7 0-3Z" transform="rotate(${i*45})" fill="${ref('petal')}" stroke="#f8faf1" stroke-width="2.1"/>`).join('')}<circle r="3.4" fill="#e8b81f" stroke="#f9f4cb" stroke-width="1.4"/></g>`;
const gtEmblem=`<g transform="translate(100 96)" fill="none" stroke="#938538" stroke-width=".9"><path d="M0-13C-2-9-11-4-11 3a11 11 0 0 0 22 0c0-7-9-12-11-16Z"/><path d="M1-10q-5 0-3 5 1 2 4 2m-6 4q-5-1-5 4 0 5 5 4V4h-3M0 1h7M3.5 1v9M0 10q-1-3 0-5M7 9q3-3 0-5"/></g>`;
const gtLabel=`<path d="M62 103c5-17 27-15 38-29 11 14 33 12 38 29v112q-26 0-38 12-12-12-38-12Z" fill="#bfc3bc"/>
<path d="M63 106c5-17 26-15 37-27 11 12 32 10 37 27v106q-25 0-37 11-12-11-37-11Z" fill="${ref('gtlabel')}"/>
<path d="M63 107c5-17 26-15 37-27 11 12 32 10 37 27" stroke="#b83a32" stroke-width="4" fill="none"/>
<path d="M63 107c5-17 26-15 37-27 11 12 32 10 37 27" stroke="#e8cbb7" stroke-width="1" stroke-dasharray=".6 2.4" stroke-linecap="round" fill="none"/>
${Array.from({length:7},(_,i)=>`<path d="M${65+i*3} ${148+i*2}C${65+i*2} 203 ${135-i*2} 203 ${135-i*3} ${148+i*2}" fill="none" stroke="#ffd64c" stroke-opacity=".45" stroke-width=".9"/>`).join('')}
<path d="M68 111c0-15 21-13 32-26 11 13 32 11 32 26v36q0 11-25 13H93q-25-2-25-13Z" fill="${ref('gtwhite')}" stroke="#c5c9c3" stroke-width=".9"/>
${gtEmblem}${text(100,111,'EST 1995',3.6,'#8a7c32','style="font-family:Georgia,serif"')}
${text(100,133,'SYNERGY',15.4,'#b72c2c','style="font-family:Times New Roman,serif" letter-spacing="-.6" textLength="64" lengthAdjust="spacingAndGlyphs"')}
${text(100,141,'THE REAL KOMBUCHA',5.6,'#30382f','style="font-family:Times New Roman,serif" textLength="60" lengthAdjust="spacingAndGlyphs"')}
${lotus}${text(100,194,'GINGERADE',8.2,'#303d2c','style="font-family:Georgia,serif" letter-spacing=".45"')}
<path d="M63 208q25 0 37-5 12 5 37 5v7q-25 0-37 11-12-11-37-11Z" fill="#d5d9d1"/>
${text(100,212,'16 FL OZ · 473 mL',4.3,'#394333','style="font-family:Georgia,serif"')}
<path d="M63 216q25 0 37 10 12-10 37-10" fill="none" stroke="#b93731" stroke-width="3"/>
<path d="M63 216q25 0 37 10 12-10 37-10" fill="none" stroke="#e8d3b5" stroke-width=".8" stroke-dasharray=".5 2.2" stroke-linecap="round"/>`;

const gingerade=wrap('gts-kombucha-gingerade',"GT's Kombucha Gingerade",`${shadow(46)}
<path d="${kombuchaShape}" fill="${ref('ginger')}" stroke="#a27e2b" stroke-width=".8"/>
<g clip-path="${ref('gtclip')}"><path d="M80 52q20 3 40 0v6q-20-2-40 0Z" fill="#fff9d7" opacity=".36"/>
${gtLabel}<path d="${kombuchaShape}" fill="${ref('glass')}" opacity=".38"/>
<path d="M81 57Q68 66 68 86v137" fill="none" stroke="#fff6b0" stroke-opacity=".35" stroke-width="2.2"/>
<path d="M130 81v142" stroke="#f8e6a1" stroke-opacity=".16" stroke-width="1"/>
</g><path d="M67 228q33 9 66 0" fill="none" stroke="#b3af7d" stroke-width="2.3"/>
<path d="M69 231q31 7 62 0" fill="none" stroke="#f4eed1" stroke-opacity=".75" stroke-width="1.2"/>
<path d="M80 44q20 6 40 0M82 49q18 4 36 0" fill="none" stroke="#a9b39c" stroke-width="1.7"/>
<path d="M79 25q21-5 42 0l1 18q-22 6-44 0Z" fill="${ref('whitecap')}" stroke="#b6bdb5" stroke-width=".7"/>
<ellipse cx="100" cy="25" rx="21" ry="4" fill="#f6f7ef"/>
${flutes(81,27,20,2,11,'#bbc3ba',.65)}
<path d="M79 39q21 4 42 0" fill="none" stroke="#b8c1b7" stroke-width="1.4"/>
<path d="M80 41q20 4 40 0" fill="none" stroke="#fdfdf6" stroke-width="1.1"/>
`, `<clipPath id="__ID__gtclip"><path d="${kombuchaShape}"/></clipPath>
<linearGradient id="__ID__ginger"><stop stop-color="#c69220"/><stop offset=".22" stop-color="#f6c73e"/><stop offset=".56" stop-color="#e8ad18"/><stop offset=".85" stop-color="#d79b1d"/><stop offset="1" stop-color="#a57d24"/></linearGradient>
<linearGradient id="__ID__gtwhite"><stop stop-color="#dde0da"/><stop offset=".25" stop-color="#fffff8"/><stop offset=".65" stop-color="#f3f5ed"/><stop offset="1" stop-color="#cbd0c7"/></linearGradient>
<radialGradient id="__ID__gtlabel" cx=".5" cy=".62" r=".65"><stop stop-color="#ffe360"/><stop offset=".5" stop-color="#f6ab25"/><stop offset=".82" stop-color="#ec7920"/><stop offset="1" stop-color="#c83d2a"/></radialGradient>
<linearGradient id="__ID__petal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#c24323"/><stop offset=".5" stop-color="#f3b42c"/><stop offset="1" stop-color="#e6c33a"/></linearGradient>
<linearGradient id="__ID__whitecap"><stop stop-color="#b8c0b7"/><stop offset=".23" stop-color="#f5f7ef"/><stop offset=".6" stop-color="#e4e9df"/><stop offset="1" stop-color="#b7c0b7"/></linearGradient>`);

export const records=[{
 slug:'gatorade-lemon-lime',family:'sports-drink-sculpted-pet',packageChoice:'US Gatorade Thirst Quencher Lemon Lime, 28 fl oz / 828 mL orange-cap sculpted PET bottle, UPC 052000135152. Manufacturer SmartLabel front dated February 2025.',
 references:[source('https://smartlabel.pepsico.info/052000135152-0015-en-US/index.html','https://smartlabel.pepsico.info/052000135152-0015-en-US/images/69130fad-5cec-4511-a2ae-5660591aff08.png','Opened and inspected the complete manufacturer bottle image: short ribbed orange cap, stepped neck, broad asymmetric molded shoulder, chartreuse liquid, pinched grip waist and wide foot. Gray wrap label carries white black-edged G and orange/red bolt over a yellow-green bolt, dark header, Lemon Lime yellow-green callout and 28 FL OZ / 828 mL. Small athlete/honeycomb and fine claims are omitted rather than invented.')],
 uncertainty:'Catalog does not specify package size. Selected this documented US 28oz regular Thirst Quencher, distinct from Zero, G2, Fit and powder. Representative inspected package version; final aesthetic approval and native review pending.',status:'needs-review',svg:prune(gatorade)
},{
 slug:'gts-kombucha-gingerade',family:'kombucha-glass-bottle',packageChoice:"US GT's SYNERGY Gingerade, 16 fl oz / 473 mL glass bottle with white ribbed cap; current official product-page image with THE REAL KOMBUCHA label.",
 references:[source('https://gtslivingfoods.com/products/gts-kombucha-gingerade','https://gtslivingfoods.com/cdn/shop/files/SYN_FLAVORS_6.png?v=1735704017&width=2188','Opened and inspected official 16oz bottle: narrow glass cylinder, broad rounded shoulders, short clear neck, white ribbed cap, golden ginger kombucha. Ornate pointed silver/red frame around white SYNERGY / THE REAL KOMBUCHA field, small gold GT emblem, orange-yellow lower label, eight-petal flower and black GINGERADE. Source has a large gold promotional halo; that backdrop is intentionally excluded from transparent artwork.')],
 uncertainty:'Catalog omits size and subline. Chosen representative standard US SYNERGY Gingerade, not the separately marketed 21+ CLASSIC formula. The catalog does not specify a subline. Small label claims and fine decorative marks omitted; final aesthetic approval and native review pending.',status:'needs-review',svg:prune(gingerade)
}];
