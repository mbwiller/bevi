// Bundles src/index.ts exactly the way Arjun's Edge Function build does (esbuild, ESM, platform
// neutral) and fails if the bundle needs Node or touches impure globals. A Node-only import
// fails here, in this package's CI, instead of in the Edge Function build.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bDate\.now\b/, 'Date.now (pass time in)'],
  [/\bnew Date\(\s*\)/, 'new Date() (pass time in)'],
  [/\bMath\.random\b/, 'Math.random (use prng.ts with a seed)'],
  [/\bprocess\b/, 'process (Node)'],
  [/\bBuffer\b/, 'Buffer (Node)'],
  [/\brequire\s*\(/, 'require (CommonJS)'],
  [/\bfetch\s*\(/, 'fetch (I/O)'],
  [/\b(window|document|localStorage)\b/, 'DOM globals'],
];

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  metafile: true,
  write: false,
  logLevel: 'silent',
}).catch((err: { errors?: Array<{ text: string }> }) => {
  for (const e of err.errors ?? []) console.error(`esbuild: ${e.text}`);
  process.exit(1);
});

// eval/ (the offline harness) and test/ are Node-side tooling; nothing in the bundle may reach them.
const leaked = Object.keys(result.metafile?.inputs ?? {}).filter((f) => /(^|\/)(eval|test|scripts)\//.test(f));
if (leaked.length > 0) {
  console.error(`bundle-smoke: the bundle includes non-src files: ${leaked.join(', ')}`);
  process.exit(1);
}

const code = (result.outputFiles[0]?.text ?? '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const hits = FORBIDDEN.filter(([re]) => re.test(code)).map(([, why]) => why);
if (hits.length > 0) {
  console.error(`bundle-smoke: the bundle uses ${hits.join(', ')}`);
  process.exit(1);
}
console.log(`bundle-smoke: ok (${code.length} bytes, esm, platform neutral)`);
