/** Build authored family recipes into SVG, PNG, a UUID manifest and review gallery.
 * npm install --prefix /tmp/bevi-icon-tools --no-save @resvg/resvg-js@2.6.2
 * node --experimental-strip-types scripts/icons/build.mjs
 * Optional: BEVI_RESVG_MODULE=/absolute/path/to/@resvg/resvg-js
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { STYLE_VERSION, esc } from './style.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'design/beverage-icons');
const inventory = JSON.parse(readFileSync(join(out,'catalog-inventory.json'),'utf8'));
const catalog = new Map(inventory.beverages.map(row=>[row.slug,row]));
const require = createRequire(import.meta.url);
const rendererModule = process.env.BEVI_RESVG_MODULE || '/tmp/bevi-icon-tools/node_modules/@resvg/resvg-js';
const { Resvg } = require(rendererModule);
const fonts = ['Arial.ttf','Arial Bold.ttf','Arial Italic.ttf','Arial Bold Italic.ttf','Georgia.ttf','Georgia Bold.ttf','Georgia Italic.ttf','Georgia Bold Italic.ttf','Times New Roman.ttf','Times New Roman Bold.ttf','Times New Roman Italic.ttf'].map(name=>`/System/Library/Fonts/Supplemental/${name}`);
for (const font of fonts) if (!existsSync(font)) throw new Error(`Required export font missing: ${font}`);
const hash = data => createHash('sha256').update(data).digest('hex');
const renderer = { package:'@resvg/resvg-js', version: require(join(dirname(require.resolve(rendererModule)),'package.json')).version, width:600,height:780, fonts:fonts.map(path=>({name:path.split('/').at(-1),sha256:hash(readFileSync(path))})) };
if(renderer.version!=='2.6.2') throw new Error('Use the pinned @resvg/resvg-js@2.6.2 renderer');
for (const dir of ['svg','portable-svg','png','review']) mkdirSync(join(out,dir),{recursive:true});
const records = [];
const seen = new Set();
for (const file of readdirSync(join(root,'scripts/icons/families')).filter(f=>f.endsWith('.mjs')).sort()) {
  const family = await import(pathToFileURL(join(root,'scripts/icons/families',file)));
  for (const recipe of family.records) {
    const bev = catalog.get(recipe.slug);
    if (!bev || seen.has(recipe.slug)) throw new Error(`Unknown or duplicate slug: ${recipe.slug}`);
    seen.add(recipe.slug);
    const svg = recipe.svg;
    if (!svg.includes('viewBox="0 0 200 260"') || /<script|<foreignObject|<image\b|https?:\/\/(?!www.w3.org\/2000\/svg)/i.test(svg)) throw new Error(`Invalid/self-contained SVG contract: ${recipe.slug}`);
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    if (ids.length!==new Set(ids).size) throw new Error(`Duplicate SVG IDs: ${recipe.slug}`);
    for (const [,id] of svg.matchAll(/url\(#([^\)]+)\)/g)) if(!ids.includes(id)) throw new Error(`Missing SVG ref ${id}: ${recipe.slug}`);
    for (const [,id] of svg.matchAll(/href="#([^"]+)"/g)) if(!ids.includes(id)) throw new Error(`Missing SVG href ${id}: ${recipe.slug}`);
    if (!recipe.references?.length) throw new Error(`Missing research provenance: ${recipe.slug}`);
    const svgPath=`svg/${recipe.slug}.svg`, pngPath=`png/${recipe.slug}.png`;
    writeFileSync(join(out,svgPath),svg+'\n');
    const rendered = new Resvg(svg,{fitTo:{mode:'width',value:600},font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:'Arial',sansSerifFamily:'Arial',serifFamily:'Georgia'}});
    const portablePath=`portable-svg/${recipe.slug}.svg`;
    const portable=rendered.toString();
    if (/<text[\s>]/.test(portable)) throw new Error(`Portable SVG still has text: ${recipe.slug}`);
    const png = new Resvg(portable,{fitTo:{mode:'width',value:600},font:{loadSystemFonts:false}}).render().asPng();
    writeFileSync(join(out,portablePath),portable);
    writeFileSync(join(out,pngPath),png);
    const {svg:_,...info} = recipe;
    records.push({...info,bevId:bev.bevId,name:bev.name,brand:bev.brand,isStarter:bev.isStarter,styleVersion:STYLE_VERSION,assets:{svg:svgPath,portableSvg:portablePath,png:pngPath,svgSha256:hash(svg+'\n'),portableSvgSha256:hash(portable),pngSha256:hash(png),pngBytes:png.length},sourceModule:`scripts/icons/families/${file}`});
  }
}
records.sort((a,b)=>a.name.localeCompare(b.name));
const pending = inventory.beverages.filter(row=>!seen.has(row.slug));
const summary={catalog:catalog.size,authored:records.length,pending:pending.length,starterAuthored:records.filter(r=>r.isStarter).length,starterTotal:inventory.summary.starters,livePostgresReconciled:false};
const manifest={schemaVersion:1,styleVersion:STYLE_VERSION,renderer,summary,records};
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(out,'coverage.json'),JSON.stringify({summary,pending:pending.map(({bevId,slug,name,brand,isStarter})=>({bevId,slug,name,brand,isStarter,status:'needs-reference'}))},null,2)+'\n');

const cards=records.map(r=>`<article class="card" data-search="${esc(`${r.name} ${r.brand} ${r.family}`.toLowerCase())}"><div class="preview"><img src="${esc(r.assets.png)}" alt="${esc(r.name)}" width="200" height="260"></div><div class="info"><div class="eyebrow">${esc(r.family)} ${r.isStarter?' · STARTER':''}</div><h2>${esc(r.name)}</h2><p>${esc(typeof r.packageChoice==='string'?r.packageChoice:JSON.stringify(r.packageChoice))}</p><div class="links"><a href="${esc(r.assets.svg)}">SVG master ↗</a><a href="${esc(r.assets.png)}">PNG ↗</a>${r.references.map((ref,i)=>`<a href="${esc(ref.pageUrl)}" target="_blank" rel="noopener noreferrer">Reference ${i+1} ↗</a>`).join('')}</div><details><summary>Evidence & review notes</summary><p>Status: ${esc(r.status)}</p><p>${esc(typeof r.uncertainty==='string'?r.uncertainty:JSON.stringify(r.uncertainty??[]))}</p>${r.references.map(ref=>`<p>${esc(typeof ref.observations==='string'?ref.observations:JSON.stringify(ref.observations??''))}</p>`).join('')}<code>${esc(r.bevId)}</code></details></div></article>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bevi · Beverage icon studio</title><style>
:root{font-family:Arial,sans-serif;color:#30263d;background:#f8f6f2;--tile:#eeebe7;--size:155px}*{box-sizing:border-box}body{margin:0}header,main{max-width:1320px;margin:auto;padding:32px}header{padding-bottom:22px}.wordmark{font-family:Georgia,serif;font-size:32px;font-weight:bold;color:#593d78;letter-spacing:-2px}.eyebrow{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#766b82}h1{font-family:Georgia,serif;font-weight:normal;font-size:42px;letter-spacing:-1.2px;margin:16px 0 12px}header p{max-width:780px;line-height:1.6;color:#756b7c}.stats{display:flex;gap:28px;margin:24px 0}.stats b{font-size:26px;display:block}.stats span{font-size:11px;color:#766b82}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}input,button,select{font:inherit;background:#fff;border:1px solid #ded7e5;border-radius:10px;padding:10px 14px;color:inherit}input{flex:1;min-width:190px}button{cursor:pointer}main{padding-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:18px}.card{background:#fff;border:1px solid #e8e2eb;border-radius:20px;overflow:hidden}.preview{height:230px;display:flex;align-items:center;justify-content:center;background:var(--tile)}.preview img{width:var(--size);height:var(--size);padding:calc(var(--size) * .08);object-fit:contain;box-sizing:border-box}.info{padding:20px}h2{font-size:15px;line-height:1.4;margin:8px 0}.info p{font-size:12px;line-height:1.6;color:#786e80}.links{display:flex;gap:12px;flex-wrap:wrap;margin:15px 0}a{color:#624387;font-size:11px}details{font-size:11px;color:#786e80}summary{cursor:pointer}code{font-size:9px;overflow-wrap:anywhere}.dark{--tile:#292630}.checker{--tile:repeating-conic-gradient(#e7e3eb 0% 25%,#fff 0% 50%) 50% / 20px 20px}.note{font-size:11px;color:#817687;padding-top:24px}.hidden{display:none}@media(max-width:600px){header,main{padding:22px}h1{font-size:34px}.grid{grid-template-columns:1fr 1fr;gap:10px}.info{padding:12px}.preview{height:180px}.stats{gap:20px}}
</style><header><div class="wordmark">bevi.</div><div class="eyebrow" style="margin-top:20px">The beverage icon collection · Pilot 01</div><h1>A little more character<br>in every sip.</h1><p>Product-specific illustrations, built from real references in the original Bevi style. Inspect the artwork at app sizes, compare packaging sources, and download each editable master.</p><div class="stats"><div><b>${summary.authored}</b><span>icons authored</span></div><div><b>${summary.starterAuthored} / ${summary.starterTotal}</b><span>starters covered</span></div><div><b>${summary.pending}</b><span>catalog drinks remaining</span></div></div><div class="toolbar"><input id="search" type="search" placeholder="Find a drink, brand, or container…" aria-label="Filter icons"><label>Tile <select id="size"><option>40</option><option>56</option><option>96</option><option selected>155</option><option>220</option></select></label><button id="theme">Light surface</button><a href="style-reference/index.html">Original style references ↗</a></div></header><main><div class="grid">${cards}</div><p id="empty" hidden>No matching drinks.</p><p class="note">SVG masters · transparent 600 × 780 PNG exports · catalog UUID mapping · native app integration and live Postgres reconciliation pending. See manifest.json for research and review status. Unresolved product details are recorded per icon.</p></main><script>document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();let n=0;document.querySelectorAll('.card').forEach(c=>{const shown=c.dataset.search.includes(q);c.classList.toggle('hidden',!shown);n+=shown});document.querySelector('#empty').hidden=!!n});document.querySelector('#size').addEventListener('change',e=>document.documentElement.style.setProperty('--size',e.target.value+'px'));let theme=0;document.querySelector('#theme').addEventListener('click',e=>{theme=(theme+1)%3;document.body.classList.toggle('dark',theme===1);document.body.classList.toggle('checker',theme===2);e.target.textContent=['Light surface','Dark surface','Transparency'][theme]});</script></html>`;
writeFileSync(join(out,'index.html'),html);
console.log(JSON.stringify(summary,null,2));
