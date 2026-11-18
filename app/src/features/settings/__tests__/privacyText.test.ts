import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRIVACY_MARKDOWN } from '../privacyText.generated';

// The drift guard: no workflow runs scripts/gen-privacy-text.mjs, so this fails when
// public/privacy.md changed and the bundled copy Settings › Privacy renders was not regenerated.

const APP_DIR = join(__dirname, '../../../..');

it('privacyText.generated.ts matches public/privacy.md', () => {
  const source = readFileSync(join(APP_DIR, 'public/privacy.md'), 'utf8');
  if (PRIVACY_MARKDOWN !== source) {
    throw new Error(
      'src/features/settings/privacyText.generated.ts is out of date with public/privacy.md. ' +
        'Run `node scripts/gen-privacy-text.mjs` from app/ and commit the result.',
    );
  }
});

it('says the session is kept on the device, not in a browser', () => {
  expect(PRIVACY_MARKDOWN).toContain('Your sign-in session is kept on your device.');
  expect(PRIVACY_MARKDOWN).not.toMatch(/browser/i);
});
