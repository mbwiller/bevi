#!/usr/bin/env node
// Runs after `expo export` (vercel.json, CI): the web build must not contain the jest-only FakeApi,
// its fixture people, the old mock's fake users, or draft copy, and it must have the Supabase URL
// inlined (proof the env vars reached the build). Scans everything in dist/ that is text.
// It must also still have the app's component names in it: the internal bug reporter reads them
// at run time, and only metro.minify.js keeps the minifier from mangling them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

// String literals that survive minification. The legacy-storage cleanup legitimately contains
// `bevi.mock.db` and `mock-user-`, so those are not listed.
const FORBIDDEN = [
  // src/testing/fakeApi
  'bevi.fake.db',
  'fake-asset://',
  'tester-pass-1',
  'test-invite',
  'Featured test Bev',
  // packages/conformance (@bevi/conformance): the BeviApi conformance suite's default password
  'conformance-pass-1',
  // the old in-browser mock's people and secrets
  'Demo Drinker',
  'demo1234',
  'Jules Moreau',
  'Priya Kapoor',
  'bevi-dev',
  // draft copy and invented catalog rows
  'Draft for Matt',
  'local-brewery-',
];

// Components the reporter is most often pointed at. One of them surviving as `function Name(` is
// proof the minifier kept names; all of them missing means it did not (or all three were renamed).
const COMPONENTS = ['TabBar', 'Header', 'BevRow'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).filter((f) => /\.(js|html|json|md|css|txt)$/.test(f));
const hits = [];
let urlFound = false;
let namesFound = false;
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const s of FORBIDDEN) if (text.includes(s)) hits.push(`${relative(dist, f)}: ${s}`);
  if (url && text.includes(url)) urlFound = true;
  if (f.endsWith('.js') && COMPONENTS.some((name) => text.includes(`function ${name}(`))) namesFound = true;
}

if (hits.length) {
  console.error(`check-bundle: the build contains test-only or fake content:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
if (!url) {
  console.error('check-bundle: EXPO_PUBLIC_SUPABASE_URL is not set, so the build cannot be checked for it.');
  process.exit(1);
}
if (!urlFound) {
  console.error(`check-bundle: ${url} is not in the bundle: the env vars did not reach the build.`);
  process.exit(1);
}
if (!namesFound) {
  console.error(
    `check-bundle: no component name survived minification (looked for ${COMPONENTS.map((name) => `\`function ${name}(\``).join(', ')}).\n` +
      '  The internal bug reporter names what a tester points at by these names, so every report would lose its component and file.\n' +
      '  Look at app/metro.minify.js, which keeps them, and at app/metro.config.js, which must still point `transformer.minifierPath` at it:\n' +
      '  an Expo or Metro upgrade that changes the minifier, or what it is passed, breaks this silently.',
  );
  process.exit(1);
}
console.log(`check-bundle: ok (${files.length} files, no test-only content, Supabase URL inlined, component names kept)`);
