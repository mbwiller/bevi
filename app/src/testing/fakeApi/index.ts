// The in-memory BeviApi test double. TEST-ONLY: jest.setup.js swaps `@/api/client` for ./client, and
// no production file may import src/testing/** (src/api/__tests__/test-double-isolation.test.ts).

export { FakeApi, type FakeApiOptions } from './FakeApi';
export { getFakeApi } from './instance';
export { controls, type FakeControls } from './controls';
export { userIdFor } from './fixtures';
export { ALCOHOLIC_BEV_ID, FAKE_INVITE_CODE, FRIEND, ME, MINOR } from './people';
