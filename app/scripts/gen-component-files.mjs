#!/usr/bin/env node
// Writes src/features/bug-report/componentFiles.generated.ts: every component the app defines in
// src/**/*.tsx, mapped to the file that defines it. The internal bug reporter reads a component's
// name off its React fiber (pick.ts) and looks the file up here, so a ticket can say
// `app/src/components/TabBar.tsx`. A name that is not in the map is not the app's (React Native,
// react-native-web, Expo Router and Reanimated internals), which is how picking skips them.
//
//   node app/scripts/gen-component-files.mjs          (or `npm run gen:components -w app`)
//   node app/scripts/gen-component-files.mjs --check  exits 1 when the committed file is stale
//
// componentFiles.test.ts runs the same functions in memory and fails on drift.
//
// Everything above `main` is a pure function on strings, with no dependency: the test transpiles
// this file's source to CommonJS and calls them, because jest's Babel transform does not cover .mjs.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo-relative, with forward slashes. */
export const OUTPUT = 'app/src/features/bug-report/componentFiles.generated.ts';

const NAME = '[A-Z][A-Za-z0-9_$]*';
const PATTERNS = [
  // function Name(   export function Name(   export default function Name<T>(
  new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+(${NAME})\\s*[(<]`, 'gm'),
  // const Name = memo(   const Name = React.forwardRef<…>(
  new RegExp(`^(?:export\\s+)?const\\s+(${NAME})\\s*(?::[^=\\n]+)?=\\s*(?:React\\.)?(?:memo|forwardRef)\\s*[(<]`, 'gm'),
  // const Name = (props) =>   const Name = props =>   const Name = ({ a, b }: Props): ReactNode =>
  new RegExp(
    `^(?:export\\s+)?const\\s+(${NAME})\\s*(?::[^=\\n]+)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=>`,
    'gm',
  ),
];

/** PascalCase: a capital first, and a lower-case letter somewhere (so `WRAP` and `TABS` are not components). */
function isComponentName(name) {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name);
}

/** The component names one .tsx file defines at its top level, in source order, each once. */
export function componentNames(source) {
  const found = [];
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (isComponentName(match[1])) found.push({ name: match[1], at: match.index });
    }
  }
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.name))];
}

/** Whether a path (relative to app/, forward slashes) is scanned. */
export function isScanned(appRelativePath) {
  if (!appRelativePath.startsWith('src/') || !appRelativePath.endsWith('.tsx')) return false;
  if (appRelativePath.endsWith('.test.tsx')) return false;
  if (appRelativePath.startsWith('src/testing/')) return false;
  return !appRelativePath.split('/').includes('__tests__');
}

/** On a duplicate name: components/ wins over features/, which wins over everything else, with the routes in app/ last. */
function rank(appRelativePath) {
  if (appRelativePath.startsWith('src/components/')) return 0;
  if (appRelativePath.startsWith('src/features/')) return 1;
  if (appRelativePath.startsWith('src/app/')) return 3;
  return 2;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The files that can run: the scanned ones, minus `X.tsx` where `X.web.tsx` exists. The app ships
 * for the web only, where Metro resolves the `.web` file and the plain one is never bundled.
 */
function liveFiles(files) {
  const paths = new Set(files.map((f) => f.path));
  return files
    .filter((f) => isScanned(f.path))
    .filter((f) => f.path.endsWith('.web.tsx') || !paths.has(f.path.replace(/\.tsx$/, '.web.tsx')));
}

/** A route file's screen: under src/app/, and neither a layout nor one of Expo Router's `+` files other than +not-found. */
export function isRouteFile(appRelativePath) {
  if (!appRelativePath.startsWith('src/app/') || !isScanned(appRelativePath)) return false;
  const base = appRelativePath.split('/').pop();
  if (base === '_layout.tsx') return false;
  return !base.startsWith('+') || base === '+not-found.tsx';
}

/**
 * The name of the component a route file exports as its default: `export default function Name`,
 * `export default Name;` or `export { Name as default }`. Null when it has none of those.
 */
export function defaultExportName(source) {
  const match =
    new RegExp(`^export\\s+default\\s+(?:async\\s+)?function\\s+(${NAME})\\s*[(<]`, 'm').exec(source) ??
    new RegExp(`^export\\s+default\\s+(${NAME})\\s*;?\\s*$`, 'm').exec(source) ??
    new RegExp(`^export\\s*\\{[^}]*\\b(${NAME})\\s+as\\s+default\\b[^}]*\\}`, 'm').exec(source);
  return match && isComponentName(match[1]) ? match[1] : null;
}

/**
 * The manifest for a set of files. `files` is [{ path, source }], `path` relative to app/ with
 * forward slashes. Returns:
 *   manifest    name → repo-relative path, keys sorted; on a duplicate name the preferred file;
 *   duplicates  each name defined in more than one file → every such file, preferred first;
 *   screens     each route's screen component (its file's default export) → the route file.
 */
export function buildManifest(files) {
  const scanned = liveFiles(files).sort((a, b) => rank(a.path) - rank(b.path) || byText(a.path, b.path));
  const owners = new Map();
  const screenRoutes = new Map();
  for (const file of scanned) {
    for (const name of componentNames(file.source)) {
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(`app/${file.path}`);
    }
    if (isRouteFile(file.path)) {
      const screen = defaultExportName(file.source);
      if (screen && !screenRoutes.has(screen)) screenRoutes.set(screen, `app/${file.path}`);
    }
  }
  const manifest = {};
  const duplicates = {};
  for (const name of [...owners.keys()].sort(byText)) {
    const paths = owners.get(name);
    manifest[name] = paths[0];
    if (paths.length > 1) duplicates[name] = paths;
  }
  const screens = {};
  for (const name of [...screenRoutes.keys()].sort(byText)) screens[name] = screenRoutes.get(name);
  return { manifest, duplicates, screens };
}

/** The generated file's text. */
export function render({ manifest, duplicates, screens }) {
  return [
    '// Generated by app/scripts/gen-component-files.mjs from app/src/**/*.tsx. Never hand-edited:',
    '// re-run `npm run gen:components -w app` (or `node app/scripts/gen-component-files.mjs`) after',
    '// adding, renaming or moving a component. componentFiles.test.ts fails when this file is stale.',
    '',
    '/**',
    ' * Every component the app defines, mapped to its source file. The internal bug reporter reads a',
    " * component's name off its React fiber and looks the file up here (pick.ts); a name that is not",
    " * a key is not the app's. On a duplicate name components/ wins over features/ over app/.",
    ' */',
    'export const COMPONENT_FILES: Readonly<Record<string, string>> = {',
    ...Object.keys(manifest).map((name) => `  ${name}: '${manifest[name]}',`),
    '};',
    '',
    '/**',
    ' * The names more than one file defines, with every file, the preferred one first. pick.ts takes',
    ' * the file a neighbouring component in the same tree comes from, when one of these matches it.',
    ' */',
    'export const DUPLICATE_COMPONENT_FILES: Readonly<Record<string, readonly string[]>> = {',
    ...Object.keys(duplicates).map(
      (name) => `  ${name}: [${duplicates[name].map((path) => `'${path}'`).join(', ')}],`,
    ),
    '};',
    '',
    '/**',
    " * Each route's screen component (the default export of a file under app/src/app that is not a",
    ' * layout), mapped to that route file. The component itself may live in features/.',
    ' */',
    'export const SCREEN_ROUTES: Readonly<Record<string, string>> = {',
    ...Object.keys(screens).map((name) => `  ${name}: '${screens[name]}',`),
    '};',
    '',
  ].join('\n');
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Every scanned file under `appDir`, read from disk. */
export function readFiles(appDir) {
  return walk(join(appDir, 'src'))
    .map((file) => ({ file, path: relative(appDir, file).split(sep).join('/') }))
    .filter((f) => isScanned(f.path))
    .map((f) => ({ path: f.path, source: readFileSync(f.file, 'utf8') }));
}

function main() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(appDir, '..', OUTPUT);
  const built = buildManifest(readFiles(appDir));
  const { manifest, duplicates, screens } = built;
  const text = render(built);
  const count = Object.keys(manifest).length;

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(out, 'utf8');
    } catch {
      // Missing counts as stale.
    }
    if (current !== text) {
      console.error(`gen-component-files: ${OUTPUT} is stale. Run \`npm run gen:components -w app\`.`);
      process.exit(1);
    }
    console.log(`gen-component-files: up to date (${count} components)`);
    return;
  }

  writeFileSync(out, text);
  console.log(`gen-component-files: wrote ${count} components, ${Object.keys(screens).length} of them screens, to ${OUTPUT}`);
  for (const name of Object.keys(duplicates)) {
    console.log(`  note: ${name} is defined in ${duplicates[name].length} files; using ${manifest[name]}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
