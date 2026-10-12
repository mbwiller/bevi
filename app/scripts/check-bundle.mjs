#!/usr/bin/env node
// Runs after `expo export` (vercel.json, CI): the web build must not contain the jest-only FakeApi,
// its fixture people, the old mock's fake users, or draft copy, and it must have the Supabase URL
// inlined (proof the env vars reached the build). Scans everything in dist/ that is text.

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

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).filter((f) => /\.(js|html|json|md|css|txt)$/.test(f));
const hits = [];
let urlFound = false;
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const s of FORBIDDEN) if (text.includes(s)) hits.push(`${relative(dist, f)}: ${s}`);
  if (url && text.includes(url)) urlFound = true;
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
console.log(`check-bundle: ok (${files.length} files, no test-only content, Supabase URL inlined)`);
