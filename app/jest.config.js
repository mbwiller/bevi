/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  // Data a test imports, not a test: it sits in __tests__/ next to its consumer.
  testPathIgnorePatterns: ['/node_modules/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
  // Tests that render the whole route tree (renderRouter) load every route on their first render,
  // which takes several seconds on a cold CI runner.
  testTimeout: 30_000,
  // CI was dying with "FATAL ERROR: Reached heap limit - JavaScript heap out of memory" (exit 134),
  // not on any one test: a worker runs suite after suite, each mounting the route tree through
  // jest-expo and react-native-web, and its heap creeps until it passes Node's default ceiling (the
  // crash reported 2083MB). It was never a clean failure -- run 43537391961 is main at 1e3e87e four
  // times over and went failure, failure, success, failure, so green runs were retries.
  //
  // Recycling a worker past a limit bounds that creep instead of raising the ceiling, so a real leak
  // still fails rather than dying more slowly. The limit has to sit above what a worker legitimately
  // uses, which the first version of this (512MB, #210) did not: `jest --logHeapUsage` puts normal
  // suites at 460-744MB, YourLists heaviest, so workers were over the limit almost always, jest
  // recycled continuously and killed one mid-suite ("A jest worker process was terminated by another
  // process: signal=SIGTERM"), taking Feed and Comments down with it -- 1099 tests passed and those
  // two never ran. 1GB clears the measured peak and still leaves a wide margin under the ceiling.
  //
  // CI creeps further than a laptop does because it has fewer cores, so each worker takes more files.
  workerIdleMemoryLimit: '1GB',
  moduleNameMapper: {
    // Its "react-native" exports are untranspiled ESM (.mjs); the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
