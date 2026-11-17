// `npm run icons:report` — rewrite design/beverage-icons/REVIEW.md from the
// swipe verdicts (verdicts/*.json) and the manifest. Run it after sorting icons
// and after a build that adds or redraws icons, and commit the result.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { REVIEWERS, parseManifest, parseVerdictFile, type VerdictFiles } from './swipe-core.ts';
import { renderReport } from './verdict-report-core.ts';

const iconsDir = join(resolve(fileURLToPath(new URL('../..', import.meta.url))), 'design/beverage-icons');
const records = parseManifest(await readFile(join(iconsDir, 'manifest.json'), 'utf8'));
const files: VerdictFiles = {};
for (const reviewer of REVIEWERS) {
  try { files[reviewer] = parseVerdictFile(await readFile(join(iconsDir, 'verdicts', `${reviewer}.json`), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const report = renderReport(records, files);
await writeFile(join(iconsDir, 'REVIEW.md'), report);
console.log(report.split('\n').find(line => line.startsWith('**')) ?? '');
console.log(`Wrote ${join(iconsDir, 'REVIEW.md')}`);
