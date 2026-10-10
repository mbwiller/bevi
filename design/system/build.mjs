// Builds project/components/bundle.js (+ header), bundle.css and index.d.ts, and a local tokens.css for the shot harness.
import fs from 'fs';
import path from 'path';
import * as esbuild from 'esbuild';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const P = (...x) => path.join(ROOT, ...x);

const res = await esbuild.build({
  entryPoints: [P('src/index.js')],
  bundle: true,
  format: 'iife',
  write: false,
  minify: true,
  target: 'es2019',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  alias: { react: P('src/react-shim.js') },
  loader: { '.js': 'jsx' },
  legalComments: 'none',
});
let js = res.outputFiles[0].text;
const src = fs.readFileSync(P('src/index.js'), 'utf8');
const names = src.slice(src.indexOf('COMPONENTS = {') + 14, src.indexOf('};', src.indexOf('COMPONENTS = {'))).split(',').map((s) => s.trim()).filter(Boolean);
if (/<\/script|<!--/i.test(js)) throw new Error('bundle contains </script or <!--');
const header = '/* @ds-bundle: ' + JSON.stringify({ format: 4, namespace: 'Bevi', components: names.map((name) => ({ name })) }) + ' */\n';
fs.mkdirSync(P('project/components'), { recursive: true });
fs.writeFileSync(P('project/components/bundle.js'), header + '/* Icons: Lucide 0.460.0 (ISC). Wordmark outlined from Fredoka (OFL). */\n' + js);
fs.copyFileSync(P('src/bundle.css'), P('project/components/bundle.css'));
fs.copyFileSync(P('src/index.d.ts'), P('project/components/index.d.ts'));

// ---- local tokens.css (mirrors format.md "tokens.css as compiled"; the page generates the real one) ----
const t = JSON.parse(fs.readFileSync(P('project/tokens.json'), 'utf8'));
const themes = t.color.themes.map((x) => x.id);
const val = (tok, th) => (typeof tok.value === 'string' ? tok.value : tok.value[th] ?? tok.value[themes[0]]);
const colorish = [...t.color.tokens, ...t.shadow.tokens];
let css = '/* local harness copy */\n';
css += `:root, [data-theme="${themes[0]}"] {\n` + colorish.map((k) => `  --${k.name}: ${val(k, themes[0])};`).join('\n') + '\n}\n';
for (const th of themes.slice(1)) css += `[data-theme="${th}"] {\n` + colorish.map((k) => `  --${k.name}: ${val(k, th)};`).join('\n') + '\n  color-scheme: dark;\n}\n';
const flat = [...t.spacing.tokens, ...t.radius.tokens, ...t.size.tokens];
css += ':root {\n' + flat.map((k) => `  --${k.name}: ${k.value};`).join('\n') + '\n' + Object.entries(t.type.families).map(([k, v]) => `  --font-${k}: ${v};`).join('\n') + '\n}\n';
for (const g of t.type.groups) for (const s of g.styles) {
  css += `.${s.name} { font-family: var(--font-${s.family || g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ' letter-spacing: ' + s.letterSpacing + ';' : ''} }\n`;
}
for (const f of t.type.fonts) css += `@font-face { font-family: "${f.family}"; src: url("${P('project', f.file)}") format("woff2"); font-weight: ${f.weight}; font-display: block; }\n`;
fs.mkdirSync(P('shots'), { recursive: true });
fs.writeFileSync(P('shots/tokens.css'), css);
console.log('bundle', (header.length + js.length) / 1024 | 0, 'KB;', names.length, 'components:', names.join(' '));
