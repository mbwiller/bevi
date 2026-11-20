import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../../../app.config';

// The file iOS fetches from the web host to decide which https:// links open the app (IM-8) and
// which saved passwords it may offer. Apple reads it once per install and says nothing when it is
// wrong, so the mistakes that can be caught here are: not JSON, not served as JSON, or naming an app
// that is not this one.

const APP_DIR = join(__dirname, '../../..');
const AASA_PATH = '/.well-known/apple-app-site-association';
// The Apple team the bundle id is registered under (app.config.ts, ios.bundleIdentifier).
const TEAM_ID = '9NA45GL4CJ';

const aasa = JSON.parse(readFileSync(join(APP_DIR, 'public', AASA_PATH), 'utf8'));
const vercel = JSON.parse(readFileSync(join(APP_DIR, 'vercel.json'), 'utf8'));
const appId = `${TEAM_ID}.${config.ios?.bundleIdentifier}`;

it('names this app, by team and bundle id', () => {
  expect(aasa.applinks.details).toHaveLength(1);
  expect(aasa.applinks.details[0].appIDs).toEqual([appId]);
  expect(aasa.webcredentials.apps).toEqual([appId]);
});

it('opens the app for the links the app shares, and for nothing else', () => {
  const paths = aasa.applinks.details[0].components.map((c: { '/': string }) => c['/']);
  expect(paths).toEqual(['/user/*', '/bev/*']);
  // Every pattern is a route the app has: a link that opens the app on a missing screen is worse
  // than one that opens the browser.
  expect(paths.every((p: string) => p.startsWith('/') && p.endsWith('/*'))).toBe(true);
});

it('is served as JSON by the web host', () => {
  const rule = vercel.headers.find((h: { source: string }) => h.source === AASA_PATH);
  expect(rule.headers).toContainEqual({ key: 'Content-Type', value: 'application/json' });
});
