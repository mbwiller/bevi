import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from './verdict-report-core.ts';
import type { Entry, ManifestRecord, VerdictFiles } from './swipe-core.ts';

const sha = (seed: string) => seed.repeat(64).slice(0, 64);
const record = (slug: string, family: string, module: string, seed = 'a'): ManifestRecord => ({
  slug, name: slug.replace(/-/g, ' '), brand: 'Brand', family, isStarter: false, sourceModule: `scripts/icons/families/${module}.mjs`,
  assets: { portableSvg: `portable-svg/${slug}.svg`, portableSvgSha256: sha(seed) },
});
const entry = (verdict: Entry['verdict'], note?: string): Entry => ({ verdict, at: '2026-11-14T10:00:00.000Z', art: sha('a').slice(0, 16), ...(note ? { note } : {}) });

const records = [
  record('cola', 'soda-can', 'colas'), record('diet-cola', 'soda-can', 'colas'), record('root-beer', 'soda-can', 'batch-12'),
  record('ginger-ale', 'soda-can', 'batch-12'), record('green-tea', 'tea-bottle', 'tea'), record('new-latte', 'coffee-can', 'batch-13'),
  record('lemonade', 'juice-carton', 'tea', 'b'),
];
const files: VerdictFiles = {
  matt: { cola: entry('good'), 'diet-cola': entry('good'), 'root-beer': entry('needs-work', 'typed name | not the logo'), 'green-tea': entry('good'), lemonade: entry('needs-work') },
  arjun: { 'ginger-ale': entry('needs-work') },
};

test('the report counts every icon once and names the three piles', () => {
  const report = renderReport(records, files);
  assert.match(report, /\*\*7 icons: 3 good, 2 need work, 2 not sorted yet\.\*\*/);
  assert.match(report, /## Needs work \(2\)/);
  assert.match(report, /## Good: the reference examples \(3\)/);
  assert.match(report, /## Not sorted yet \(2\)/);
});

test('needs-work icons are listed under the recipe module that draws them, with reviewer and note', () => {
  const report = renderReport(records, files);
  assert.match(report, /### `scripts\/icons\/families\/batch-12\.mjs`: 2 of 2/);
  assert.match(report, /\| <img src="portable-svg\/root-beer\.svg" width="56" alt=""> \| root beer \| `root-beer` \| Matt \| typed name \\\| not the logo \|/);
  assert.match(report, /\| ginger ale \| `ginger-ale` \| Arjun \|  \|/);
  assert.match(report, /\| `scripts\/icons\/families\/batch-12\.mjs` \| 2 \| 0 \| 0 \|/);
  assert.match(report, /1 other recipe module is entirely Good\./);
});

test('good icons are grouped by package family and link to the published art', () => {
  const report = renderReport(records, files);
  assert.match(report, /- \*\*soda-can\*\* \(2\): \[cola\]\(portable-svg\/cola\.svg\) · \[diet cola\]\(portable-svg\/diet-cola\.svg\)/);
  assert.match(report, /- \*\*tea-bottle\*\* \(1\): \[green tea\]/);
  assert.doesNotMatch(report.split('## Good')[1].split('## Not sorted')[0], /root-beer|ginger-ale/);
});

test('a redrawn icon is reported as unsorted, with the verdict it answers', () => {
  const report = renderReport(records, files);
  assert.match(report, /\[lemonade\]\(portable-svg\/lemonade\.svg\) \(redrawn since Matt marked it needs work\)/);
  assert.match(report, /\[new latte\]\(portable-svg\/new-latte\.svg\)/);
});

test('the report is the same text for the same input, and reads sensibly with nothing sorted', () => {
  assert.equal(renderReport(records, files), renderReport(records, files));
  assert.doesNotMatch(renderReport(records, files), /20\d\d-\d\d-\d\d/);
  const empty = renderReport(records, {});
  assert.match(empty, /\*\*7 icons: 0 good, 0 need work, 7 not sorted yet\.\*\*/);
  assert.match(empty, /## Needs work \(0\)\n\nNone\./);
  assert.match(empty, /None yet\./);
});
