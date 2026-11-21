// React Native's jest preset defines `performance.now` as `jest.fn(Date.now)`, and a jest.fn keeps
// every call it receives (arguments, result, context, order) until it is cleared, which nothing does
// within a test file. React's development build reads that clock four times per component per render
// for its profiler timers: 1.5 to 2.6 million calls in ONE Feed test, each kept at over 100 bytes,
// so that suite's heap grew by about 200MB per test and its 16 tests reached Node's 4GB ceiling
// (BEV-27; the numbers are in jest.config.js). This is the same clock without the recording: the
// `Date.now` the preset captured, so the values are unchanged, including under fake timers.
// `src/__tests__/jestSetup.test.ts` fails if the recording comes back.
if (jest.isMockFunction(global.performance?.now)) {
  const dateNow = Date.now;
  global.performance.now = () => dateNow();
}

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

// Gesture Handler's native module (Sheet's drag, SwipeTabs): its own setup mocks it, so a
// GestureDetector renders its child and gestures never fire on their own.
require('react-native-gesture-handler/jestSetup');

// The app talks to Supabase through `@bevi/api` (src/api/client.ts). Suites run against the
// in-memory FakeApi instead: every importer of the client gets src/testing/fakeApi/client.ts.
jest.mock('./src/api/client', () => require('./src/testing/fakeApi/client'));

// The internal bug reporter exists on the web and on iOS (src/features/bug-report/
// supported.ts, capabilities.ts), and jest resolves modules as iOS. The reporter's long-standing
// suites are web suites: until they have a web jest project of their own (DEVELOPMENT-MATT-IOS.md,
// IM-11) they run here with the web's capabilities (a note that opens at once, sheets everywhere). What the iOS reporter does is covered by src/features/bug-report/__tests__/native*.test.*,
// which undo these two mocks.
jest.mock('./src/features/bug-report/supported', () => ({ REPORTER_SUPPORTED: true }));
jest.mock('./src/features/bug-report/capabilities', () => require('./src/features/bug-report/capabilities.web'));

// NetInfo is a native module. The library's own mock reports a connected cellular network and a
// listener that never fires, so every suite that renders the create-Bev wizard sees it online
// (src/features/create-bev/useOnline.ts; its own test drives the listener).
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

// AsyncStorage is a native module; the library's own mock keeps items in memory for the test file.
// Recents (src/features/add-bev/recents.ts) keep their list in it on native.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-application reads the installed binary's version (src/features/app-gate/installedVersion.ts).
// Suites that care mock `@/features/app-gate/installedVersion` or this module themselves.
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));

// react-native-maps is a native view (src/features/places/BevdCanvas.tsx). Under jest the map is a
// View and a marker a Pressable carrying the marker's own props, so a suite presses a pin by its
// accessible name, as it would a row.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');
  const MapView = React.forwardRef(({ children, onPress: _onPress, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: () => {} }));
    return React.createElement(View, props, children);
  });
  MapView.displayName = 'MapView';
  const Marker = ({ children, coordinate: _coordinate, ...props }) => React.createElement(Pressable, props, children);
  return { __esModule: true, default: MapView, Marker };
});
