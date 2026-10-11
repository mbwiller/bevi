// Renders each components/<C>/preview.html the way the preview frame does (tokens.css, fonts, bundle.css,
// React, bundle.js preloaded; <html data-theme>) and screenshots it in both themes with headless Chrome.
// usage: node shoot.mjs [Comp ...]
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const P = (...x) => path.join(ROOT, ...x);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = process.argv.slice(2);
const comps = fs.readdirSync(P('project/components')).filter((d) => fs.existsSync(P('project/components', d, 'preview.html')) && (!only.length || only.includes(d)));
const head = [
  `<link rel="stylesheet" href="file://${P('shots/tokens.css')}">`,
  `<link rel="stylesheet" href="file://${P('project/components/bundle.css')}">`,
  `<script src="file://${P('node_modules/react/umd/react.production.min.js')}"></script>`,
  `<script src="file://${P('node_modules/react-dom/umd/react-dom.production.min.js')}"></script>`,
  `<script src="file://${P('project/components/bundle.js')}"></script>`,
  `<script>window.addEventListener('error',e=>{document.title='ERR '+e.message})</script>`,
].join('\n');
const run = (args) => new Promise((ok) => execFile(CHROME, args, { timeout: 30000 }, (err, so, se) => ok(se)));
const jobs = [];
for (const c of comps) {
  const html = fs.readFileSync(P('project/components', c, 'preview.html'), 'utf8');
  const m = /@dsCard([^\n]*)-->/.exec(html.split('\n')[0]) || [];
  const h = +((/height=(\d+)/.exec(m[1] || '') || [])[1] || 300);
  const w = c === 'Cover' ? 960 : +((/width=(\d+)/.exec(m[1] || '') || [])[1] || 720);
  for (const theme of ['light', 'dark']) {
    const out = html.replace(/<html([^>]*)>/i, `<html$1 data-theme="${theme}">`).replace(/<head>/i, '<head>\n' + head)
      .replace(/(["'(])\.\.\/\.\.\//g, '$1file://' + P('project') + '/');
    const f = P('shots', `${c}-${theme}.html`);
    fs.writeFileSync(f, out);
    jobs.push(() => run(['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
      `--window-size=${w},${h + 24}`, '--virtual-time-budget=4000', `--screenshot=${P('shots', `${c}-${theme}.png`)}`, 'file://' + f]));
  }
}
const N = 6; let i = 0;
await Promise.all(Array.from({ length: N }, async () => { while (i < jobs.length) await jobs[i++](); }));
console.log('shot', comps.length, 'previews:', comps.join(' '));
