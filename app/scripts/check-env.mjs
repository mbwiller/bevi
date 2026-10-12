#!/usr/bin/env node
// Runs before `expo export` in the Vercel build (vercel.json): a build without the Supabase env vars
// would ship an app that can only show "Bevi isn't set up yet", so fail the deploy instead.
// Mirrors the rules in src/api/config.ts.

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const problems = [];

if (!url) problems.push('EXPO_PUBLIC_SUPABASE_URL is not set.');
else {
  try {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) problems.push('EXPO_PUBLIC_SUPABASE_URL must use https.');
  } catch {
    problems.push('EXPO_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
}

function jwtRole(k) {
  const parts = k.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

if (!key) problems.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.');
else if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
  problems.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key: it ships to every browser.');
}

if (process.env.EXPO_PUBLIC_BEVI_API) {
  console.warn('note: EXPO_PUBLIC_BEVI_API is no longer read (the app always runs on Supabase); remove it.');
}

if (problems.length) {
  console.error(`check-env: ${problems.join(' ')}`);
  process.exit(1);
}
console.log(`check-env: ok (${new URL(url).host})`);
