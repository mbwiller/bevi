// Reanimated 4 and its worklets runtime need native modules; their packaged mocks run animations
// synchronously in Jest. The Reanimated mock lacks useReducedMotion, so it reports "motion allowed".
// It is added to `react-native-reanimated/mock` itself because expo-router's testing-library
// re-mocks `react-native-reanimated` with that module, replacing the mock below in router tests.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated/mock', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// The app talks to Supabase through `@bevi/api` (src/api/client.ts). Suites run against the
// in-memory FakeApi instead: every importer of the client gets src/testing/fakeApi/client.ts.
jest.mock('./src/api/client', () => require('./src/testing/fakeApi/client'));
