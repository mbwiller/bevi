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

// The internal bug reporter is web only (src/features/bug-report/supported.ts), and jest resolves
// modules as iOS, where it is off. Its suites are web suites: until they have a web jest project of
// their own (DEVELOPMENT-MATT-IOS.md, IM-11) they run here with the reporter on. What the native app
// does is covered by src/features/bug-report/__tests__/nativeOff.test.tsx, which undoes this mock.
jest.mock('./src/features/bug-report/supported', () => ({ REPORTER_SUPPORTED: true }));

// NetInfo is a native module. The library's own mock reports a connected cellular network and a
// listener that never fires, so every suite that renders the create-Bev wizard sees it online
// (src/features/create-bev/useOnline.ts; its own test drives the listener).
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

// AsyncStorage is a native module; the library's own mock keeps items in memory for the test file.
// Recents (src/features/add-bev/recents.ts) keep their list in it on native.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The on-device text recogniser is a native (iOS Vision) module with no JS fallback under jest. Any suite
// that reaches it gets this stand-in; suites that care mock `create-bev/textRecognition` or this path themselves.
jest.mock('./modules/bevi-text-recognition', () => ({ recogniseText: jest.fn().mockResolvedValue([]) }));
