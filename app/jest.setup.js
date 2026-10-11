// Reanimated 4 and its worklets runtime need native modules; their packaged mocks run animations
// synchronously in Jest. The Reanimated mock lacks useReducedMotion, so it reports "motion allowed".
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
