/**
 * export-style-refs: ship the style reference images the icon generator conditions on.
 *
 *   node scripts/icons/export-style-refs.mjs           # render + upload
 *   node scripts/icons/export-style-refs.mjs --dry-run # render locally, upload nothing
 *
 * RUN THIS AFTER EVERY ICON BATCH. The worker reads the references from the
 * bucket, not from this repository, so new or redrawn unbranded artwork does
 * not reach the generator until this has run. It is idempotent: the same
 * manifest renders the same bytes and re-uploads over them.
 *
 * The rendered output is gitignored on purpose. It is derived from the SVG
 * masters, and committing it alongside a hash manifest would create a drift
 * guard whose correctness depends on which icon batch happens to be merged --
 * a guard that fails for reasons unrelated to this pipeline is worse than no
 * guard. The bucket is the thing that has to be current, and the deploy step
 * above is what makes it so.
 *
 * The `generate-bev-icon` Edge Function cannot read this repository, so the
 * references it sends to the image model have to live somewhere it can reach.
 * This renders them from the authored SVG masters and uploads them to the
 * private `bev-style-refs` bucket (20261119185802).
 *
 * ---------------------------------------------------------------------------
 * ONLY UNBRANDED ARTWORK, AND THAT IS A CORRECTNESS RULE
 * ---------------------------------------------------------------------------
 * The provider's output filter rejects a recognisable brand mark outright with
 * error 3030, deterministically -- the 2026-11-11 spike confirmed it by
 * isolation: `generic-espresso-martini`, `matcha-latte-with-boba` and
 * `agua-fresca-jamaica` all passed, while `coca-cola-classic` and
 * `bodyarmor-fruit-punch` failed every single time, with a neutral prompt and
 * at identical size. A branded reference therefore does not merely risk a bad
 * icon; it makes every generation that uses it fail.
 *
 * The marker is `brand === 'Generic'` in the manifest, which is the catalogue's
 * own convention (SKILL.md: "`Generic` entries use an unbranded served drink"),
 * not a family list this script would have to keep in sync.
 *
 * Every reference is rendered at `MAX_EDGE` or less, because the model accepts
 * at most four input images and each must be UNDER 512x512.
 *
 * Rendering (rather than downscaling the committed PNGs) keeps this on the same
 * deterministic path `build.mjs` uses, so a reference is exactly the artwork,
 * resampled once by the renderer instead of twice.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ICONS = join(ROOT, 'design/beverage-icons');
const OUT_DIR = join(ICONS, 'style-refs');
const BUCKET = 'bev-style-refs';

/** Under the model's 512x512 input limit with room to spare. */
const MAX_EDGE = 384;
/** The catalogue's own marker for artwork carrying no brand. */
const UNBRANDED = 'Generic';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

const rendererModule = process.env.BEVI_RESVG_MODULE || '/tmp/bevi-icon-tools/node_modules/@resvg/resvg-js';
const { Resvg } = require(rendererModule);
const rendererVersion = require(join(dirname(require.resolve(rendererModule)), 'package.json')).version;
if (rendererVersion !== '2.6.2') throw new Error(`Use the pinned @resvg/resvg-js@2.6.2 renderer, found ${rendererVersion}`);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The container family a reference teaches, so the worker can pick three that
 * suit the Bev it is drawing rather than always sending the same three.
 *
 * Every unbranded record in the catalogue is a served drink, so there is no
 * unbranded can or bottle to offer. That turns out not to matter: the
 * references carry the STYLE and the user's photograph carries the FORM, which
 * is how the spike produced a correct PET bottle from three glassware
 * references. `default` is therefore a real answer, not a fallback.
 */
const SHAPE_BY_SLUG = {
  'matcha-latte-with-boba': 'tall-glass',
  'agua-fresca-jamaica': 'tall-glass',
  'agua-fresca-tamarindo': 'tall-glass',
  'horchata-traditional': 'tall-glass',
  'generic-espresso-martini': 'stemmed',
  'generic-margarita': 'stemmed',
  'generic-pina-colada': 'stemmed',
  'generic-mojito': 'rocks',
  'generic-moscow-mule': 'rocks',
  'generic-old-fashioned': 'rocks',
};

function render(portableSvgPath) {
  const svg = readFileSync(portableSvgPath, 'utf8');
  // The masters are a 200x260 canvas, so fitting the HEIGHT to MAX_EDGE keeps
  // both edges under the model's limit; fitting the width would not.
  const png = new Resvg(svg, {
    fitTo: { mode: 'height', value: MAX_EDGE },
    font: { loadSystemFonts: false },
    // Flattened onto white ON PURPOSE. The masters are transparent, and how a
    // model treats an alpha channel is undefined; leaving it implicit is how
    // the spike ended up sending references composited onto BLACK without
    // noticing. White also matches the background the prompt asks the model to
    // draw on, so the reference and the target agree.
    background: '#ffffff',
  })
    .render()
    .asPng();
  return png;
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(ICONS, 'manifest.json'), 'utf8'));
  const chosen = manifest.records
    .filter((r) => String(r.brand ?? '').trim() === UNBRANDED)
    .sort((a, z) => (a.slug < z.slug ? -1 : 1));

  if (chosen.length === 0) {
    throw new Error(`No unbranded records in the manifest (brand === '${UNBRANDED}'). Refusing to ship a branded reference set.`);
  }

  const refs = [];
  for (const record of chosen) {
    const src = join(ICONS, record.assets.portableSvg);
    const png = render(src);
    refs.push({
      slug: record.slug,
      name: record.name,
      shape: SHAPE_BY_SLUG[record.slug] ?? 'tall-glass',
      bytes: png.length,
      sha256: sha256(png),
      png,
    });
  }

  const index = {
    bucket: BUCKET,
    maxEdge: MAX_EDGE,
    renderer: { package: '@resvg/resvg-js', version: rendererVersion },
    refs: refs.map(({ png, ...rest }) => ({ ...rest, path: `${rest.slug}.png` })),
  };
  const indexPath = join(OUT_DIR, 'index.json');
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;

  mkdirSync(OUT_DIR, { recursive: true });
  for (const ref of refs) writeFileSync(join(OUT_DIR, `${ref.slug}.png`), ref.png);
  writeFileSync(indexPath, indexJson);
  console.log(`rendered ${refs.length} unbranded references at <=${MAX_EDGE}px into design/beverage-icons/style-refs/`);

  if (DRY) {
    console.log('--dry-run: nothing uploaded');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (supabase/.env) to upload, or pass --dry-run.');
    process.exit(1);
  }

  for (const ref of refs) {
    const target = `${url.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${ref.slug}.png`;
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'image/png',
        // Replace on re-run: a redraw should ship, and the bucket is ours alone.
        'x-upsert': 'true',
      },
      body: ref.png,
    });
    if (!res.ok) {
      throw new Error(`upload ${ref.slug}: ${res.status} ${await res.text()}`);
    }
    console.log(`  uploaded ${ref.slug}.png (${ref.bytes} bytes)`);
  }
  // The worker reads this to know what is in the bucket without listing it.
  const idxRes = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/index.json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: indexJson,
  });
  if (!idxRes.ok) throw new Error(`upload index.json: ${idxRes.status} ${await idxRes.text()}`);
  console.log('  uploaded index.json');
}

await main();
