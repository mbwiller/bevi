#!/usr/bin/env node
// IA-9: the EAS build image for every profile named on the command line must be
// PINNED, not floating.
//
//   node .github/scripts/check-eas-image.mjs production preview development
//
// WHY. The build image decides the Xcode version, and Xcode has to match what
// the Expo SDK on `main` expects (DEVELOPMENT-ARJUN-IOS.md, IA-9). `main` is on
// SDK 57 while SDK 58 is npm `latest`, so the image is what SDK 57 wants and it
// moves in the same PR as Matt's SDK upgrade (IM-1), never on its own. An image
// named `latest` (or `default`) silently changes the toolchain under us: the
// same commit builds on one Xcode in the morning and another in the afternoon,
// and the first anyone hears of it is a build failure or, worse, a binary that
// behaves differently from the one that was tested.
//
// WHAT THIS CAN AND CANNOT CHECK. `app/eas.json` is the app lane's file
// (app/CLAUDE.md), and the image is a value in it, so CI cannot set it -- only
// insist on it. This check therefore enforces the enforceable half: that the
// profile names an image explicitly and that the name carries a version. WHICH
// image is SDK 57's is a fact about SDK 57 that belongs in eas.json next to the
// profile, with IM-1 as the thing that moves it.
//
// It reads eas.json itself rather than asking `eas config`, so it needs no
// EXPO_TOKEN and runs in the job that has no secrets -- a floating image fails
// the run before a single build minute is spent.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EAS_JSON = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/eas.json');

// Anything that means "whatever is newest", in any of the shapes EAS image
// names come in (`latest`, `macos-sonoma-14.6-xcode-latest`, `default`).
const FLOATING = /(^|[-_])(latest|default)$/i;

// eas.json is JSON with comments: EAS's own docs put `//` notes in it. Strip
// them with a scanner that knows about strings and escapes, so a `//` inside
// `"https://..."` survives.
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"') {
      out += c;
      i += 1;
      while (i < source.length) {
        out += source[i];
        if (source[i] === '\\') {
          out += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// A profile may `extends` another one; the image can come from either.
function resolveProfile(profiles, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`eas.json: build profile \`${name}\` extends itself`);
  seen.add(name);
  const profile = profiles[name];
  if (!profile) return null;
  const parent = profile.extends ? resolveProfile(profiles, profile.extends, seen) : null;
  return { ...(parent ?? {}), ...profile, ios: { ...(parent?.ios ?? {}), ...(profile.ios ?? {}) } };
}

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.error('check-eas-image: name at least one build profile.');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(EAS_JSON, 'utf8');
} catch {
  console.error(
    'check-eas-image: app/eas.json does not exist.\n' +
      '  It is the app lane\'s file (app/CLAUDE.md) and `eas build` cannot run without it.',
  );
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(stripComments(raw));
} catch (error) {
  console.error(`check-eas-image: app/eas.json is not valid JSON(C): ${error.message}`);
  process.exit(1);
}

const profiles = parsed.build ?? {};
const problems = [];

for (const name of wanted) {
  const profile = resolveProfile(profiles, name);
  if (!profile) {
    problems.push(`\`${name}\`: no such build profile in app/eas.json`);
    continue;
  }
  const image = profile.ios?.image;
  if (!image) {
    problems.push(`\`${name}\`: build.${name}.ios.image is not set, so EAS picks the Xcode version`);
  } else if (FLOATING.test(String(image))) {
    problems.push(`\`${name}\`: build.${name}.ios.image is \`${image}\`, which floats`);
  }
}

if (problems.length) {
  console.error(
    `check-eas-image: the iOS build image must be pinned to the Xcode Expo SDK 57 expects:\n  ${problems.join('\n  ')}\n` +
      '  Set an explicit, version-bearing image on each profile in app/eas.json (EAS lists the\n' +
      '  available images per Xcode version), and move it only in the PR that moves the SDK (IM-1).',
  );
  process.exit(1);
}

console.log(`check-eas-image: ok (${wanted.map((n) => `${n} -> ${resolveProfile(profiles, n).ios.image}`).join(', ')})`);
