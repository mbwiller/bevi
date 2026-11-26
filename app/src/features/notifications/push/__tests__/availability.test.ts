// The gate itself: `extra.push === true` and nothing else (availability.web.ts is always false).
let mockExtra: Record<string, unknown> | undefined;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExtra === undefined ? null : { extra: mockExtra };
    },
  },
}));

import { pushAvailable } from '../availability';
import { pushAvailable as pushAvailableOnWeb } from '../availability.web';

it.each([
  [undefined, false],
  [{}, false],
  [{ eas: { projectId: 'x' } }, false],
  [{ push: 'true' }, false],
  [{ push: 1 }, false],
  [{ push: false }, false],
  [{ push: true }, true],
])('extra %p: %p', (extra, available) => {
  mockExtra = extra;
  expect(pushAvailable()).toBe(available);
});

it('is never available on the web', () => {
  mockExtra = { push: true };
  expect(pushAvailableOnWeb()).toBe(false);
});
