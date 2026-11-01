// Validate coverage, assets, provenance and font-independent rendering. No network.
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(root,'design/beverage-icons');
const read=path=>readFileSync(resolve(out,path));
const manifest=JSON.parse(read('manifest.json'));
const coverage=JSON.parse(read('coverage.json'));
const inventory=JSON.parse(read('catalog-inventory.json'));
const catalog=new Map(inventory.beverages.map(r=>[r.bevId,r]));
const require=createRequire(import.meta.url);
const {Resvg}=require(process.env.BEVI_RESVG_MODULE||'/tmp/bevi-icon-tools/node_modules/@resvg/resvg-js');
const hash=data=>createHash('sha256').update(data).digest('hex');
const ids=new Set();
for(const r of manifest.records){
 assert.equal(catalog.get(r.bevId)?.slug,r.slug,`UUID mapping ${r.slug}`);
 assert(!ids.has(r.bevId));ids.add(r.bevId);
 assert(r.references.length>0&&r.references.every(ref=>ref.visuallyInspected&&ref.pageUrl.startsWith('https://')&&ref.imageUrl.startsWith('https://')&&ref.observations));
 for(const [pathKey,hashKey] of [['svg','svgSha256'],['portableSvg','portableSvgSha256'],['png','pngSha256']])assert.equal(hash(read(r.assets[pathKey])),r.assets[hashKey]);
 const portable=read(r.assets.portableSvg).toString();
 assert(!/<text[\s>]|<image[\s>]|<script[\s>]/.test(portable),`Portable SVG should be paths only: ${r.slug}`);
 const rendered=new Resvg(portable,{fitTo:{mode:'width',value:600},font:{loadSystemFonts:false}}).render();
 assert.equal(rendered.width,600);assert.equal(rendered.height,780);
 assert(rendered.asPng().equals(read(r.assets.png)),`PNG must match portable SVG without fonts: ${r.slug}`);
 const pixels=rendered.pixels;
 assert.equal(pixels[3],0);assert.equal(pixels[pixels.length-1],0);
 assert(pixels.some((value,i)=>i%4===3&&value>0),`Nonempty image: ${r.slug}`);
}
for(const row of coverage.pending){
 assert.equal(catalog.get(row.bevId)?.slug,row.slug);
 assert(!ids.has(row.bevId));ids.add(row.bevId);
 assert(['needs-reference','needs-identity-resolution'].includes(row.status));
 if(row.status==='needs-identity-resolution'){
  assert(row.uncertainty&&row.nextStep&&row.references?.length&&row.sourceModule,`Durable identity research: ${row.slug}`);
  assert(row.references.every(ref=>ref.pageUrl.startsWith('https://')&&ref.inspectedAt&&ref.observations&&typeof ref.visuallyInspected==='boolean'));
  assert(!row.assets,`Unresolved identities must not claim an asset: ${row.slug}`);
 }
}
assert.equal(ids.size,catalog.size);
assert.equal(manifest.summary.authored,manifest.records.length);
assert.equal(manifest.summary.pending,coverage.pending.length);
assert.equal(manifest.summary.identityUnresolved,coverage.pending.filter(r=>r.status==='needs-identity-resolution').length);
assert.equal(manifest.summary.starterAuthored,manifest.records.filter(r=>r.isStarter).length);
const html=read('index.html').toString();
assert.equal((html.match(/<article class="card"/g)||[]).length,manifest.records.length);
for(const [,src] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 if(!src.startsWith('https://')&&!src.startsWith('#'))assert(existsSync(resolve(out,src)),`Gallery link: ${src}`);
}
for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(script);
const original=JSON.parse(read('style-reference/source.json'));
assert.equal(hash(readFileSync(resolve(root,original.source))),original.sourceSha256,'Original prototype must remain unchanged');
console.log(`Validated ${manifest.records.length} assets: UUID coverage, provenance, hashes, SVG parsing, alpha, 600×780 dimensions, font-independent PNG parity, gallery links/scripts and original prototype preservation. ${coverage.pending.length} pending.`);
