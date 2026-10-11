// The removable mock. ONLY app/src/api/client.ts imports from this folder. To remove the mock:
// delete app/src/api/mock/ (and app/scripts/build-mock-seed.mjs), delete the mock branch in
// client.ts, and set EXPO_PUBLIC_BEVI_API=supabase.

export { MockApi, MOCK_INVITE_CODE, type MockApiOptions } from './MockApi';
export { getMockApi } from './instance';
export { mockControls, type MockControls } from './controls';
export { DEMO_HANDLE, DEMO_PASSWORD, MOCK_ALCOHOLIC_BEV_ID } from './seed/extra';
