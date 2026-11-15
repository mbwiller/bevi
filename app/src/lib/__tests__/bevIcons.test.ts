import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { BevIcon } from '@bevi/shared';

import { bevIconUri, hasBevIcon, resolveBevIcon } from '../bevIcons';
import { BEV_ICONS } from '../bevIcons.generated';

// The drift guard: no workflow runs scripts/icons/export-app.mjs, so this fails when the manifest
// gained, lost or redrew an icon and the app's copy was not regenerated. Fix: re-run the script.

const ICONS_DIR = join(__dirname, '../../../../design/beverage-icons');
const PUBLIC_DIR = join(__dirname, '../../../public/bev-icons');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ManifestRecord {
  slug: string;
  bevId: string;
  assets: { portableSvg: string; portableSvgSha256: string };
}

const manifest: { records: ManifestRecord[] } = JSON.parse(readFileSync(join(ICONS_DIR, 'manifest.json'), 'utf8'));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

it('has exactly one entry per manifest record, keyed by a UUID', () => {
  const keys = Object.keys(BEV_ICONS);
  expect(keys.length).toBe(manifest.records.length);
  expect([...keys].sort()).toEqual(manifest.records.map((r) => r.bevId).sort());
  for (const key of keys) expect(key).toMatch(UUID);
});

it.each(manifest.records.map((r) => [r.slug, r] as const))('%s points at its current portable SVG', (slug, record) => {
  const url = BEV_ICONS[record.bevId];
  const match = /^\/bev-icons\/([a-z0-9-]+)\.svg\?v=([0-9a-f]{8})$/.exec(url ?? '');
  expect(match).not.toBeNull();
  expect(match?.[1]).toBe(slug);
  expect(match?.[2]).toBe(record.assets.portableSvgSha256.slice(0, 8));

  const source = readFileSync(join(ICONS_DIR, record.assets.portableSvg));
  expect(sha256(source)).toBe(record.assets.portableSvgSha256);
  const shipped = readFileSync(join(PUBLIC_DIR, `${slug}.svg`));
  expect(shipped.equals(source)).toBe(true);
});

it('ships no icon the manifest does not claim', () => {
  expect(readdirSync(PUBLIC_DIR).sort()).toEqual(manifest.records.map((r) => `${r.slug}.svg`).sort());
});

it('looks icons up by bevId', () => {
  const [record] = manifest.records;
  expect(record).toBeDefined();
  expect(bevIconUri(record!.bevId)).toBe(BEV_ICONS[record!.bevId]);
  expect(hasBevIcon(record!.bevId)).toBe(true);
  expect(bevIconUri('coca-cola-classic')).toBeUndefined();
  expect(hasBevIcon('00000000-0000-5000-8000-000000000000')).toBe(false);
  // Not fooled by Object.prototype.
  expect(bevIconUri('constructor')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// resolveBevIcon: the four-step precedence
// ---------------------------------------------------------------------------
// The ids come from the generated map rather than being hard-coded, so these
// keep working through a redraw.

const [DRAWN_A, DRAWN_B] = Object.keys(BEV_ICONS) as [string, string];
const UNDRAWN = '00000000-0000-4000-8000-00000000fa01';

const icon = (over: Partial<BevIcon> = {}): BevIcon => ({
  bevId: UNDRAWN,
  generatedIconUrl: null,
  iconStatus: 'none',
  fallbackBevIds: [],
  labelBand: null,
  ...over,
});

describe('resolveBevIcon', () => {
  it('prefers the generated illustration over everything', () => {
    const url = 'https://example.test/bev-icons/x/icon-1024.png';
    // Even for a Bev that has authored art of its own: a generated icon exists
    // only because someone photographed that exact drink.
    expect(resolveBevIcon(DRAWN_A, icon({ generatedIconUrl: url, iconStatus: 'completed' }))).toEqual({
      uri: url,
      source: 'generated',
    });
  });

  it("falls back to the Bev's own authored icon", () => {
    expect(resolveBevIcon(DRAWN_A, icon())).toEqual({ uri: bevIconUri(DRAWN_A), source: 'authored' });
    // And with no BevIcon row at all, which is what every screen sees before
    // `bevs.icons()` resolves.
    expect(resolveBevIcon(DRAWN_A)).toEqual({ uri: bevIconUri(DRAWN_A), source: 'authored' });
  });

  it('borrows the first candidate that actually has art, skipping undrawn ones', () => {
    const resolved = resolveBevIcon(UNDRAWN, icon({ fallbackBevIds: [UNDRAWN, DRAWN_B, DRAWN_A] }));
    expect(resolved).toEqual({ uri: bevIconUri(DRAWN_B), source: 'borrowed' });
  });

  it('is undefined when nothing applies, so the caller draws category art', () => {
    expect(resolveBevIcon(UNDRAWN, icon())).toBeUndefined();
    expect(resolveBevIcon(UNDRAWN, icon({ fallbackBevIds: [UNDRAWN] }))).toBeUndefined();
    expect(resolveBevIcon(UNDRAWN, null)).toBeUndefined();
    expect(resolveBevIcon(UNDRAWN)).toBeUndefined();
  });

  it('never treats a non-completed status as art, whatever path came with it', () => {
    // finish_bev_icon_job is the only writer of both columns so they cannot
    // legitimately disagree, and mapBevIcon nulls the url unless 'completed'.
    for (const iconStatus of ['pending', 'processing', 'failed', 'none'] as const) {
      expect(resolveBevIcon(UNDRAWN, icon({ iconStatus }))).toBeUndefined();
    }
  });
});
