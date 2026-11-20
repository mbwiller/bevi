/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
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
  // uses, which the first version of this (512MB, #210) did not: `jest --logHeapUsage` put normal
  // suites at 460-744MB then, YourLists heaviest, so workers were over the limit almost always, jest
  // recycled continuously and killed one mid-suite ("A jest worker process was terminated by another
  // process: signal=SIGTERM"), taking Feed and Comments down with it -- 1099 tests passed and those
  // two never ran. 1GB cleared that measured peak and still leaves a wide margin under the ceiling.
  //
  // CI creeps further than a laptop does because it has fewer cores, so each worker takes more files.
  //
  // Most of that heap was one leak, found on 2026-11-19 (BEV-27) when Feed.test.tsx alone reached the
  // 4GB ceiling: React Native's preset makes `performance.now` a jest.fn, which keeps every call, and
  // React's development build calls it four times per component per render. jest.setup.js replaces
  // it with a plain function. Measured on a 15-core Mac over all 174 suites, per suite:
  //
  //                                     median   p90    heaviest
  //   before, `--logHeapUsage`          470MB    818MB  Comments 3349MB (Feed never finished)
  //   after,  `--logHeapUsage`, run 1   385MB    701MB  FeedSafety 1788MB
  //   after,  `--logHeapUsage`, run 2   442MB    681MB  Feed 1946MB
  //   after,  with `node --expose-gc`   164MB    244MB  Comments 415MB
  //
  // The last row is what a suite holds: with gc exposed jest collects before it measures. Without it
  // the figure includes garbage V8 has not collected yet, so it moves from run to run (Feed read
  // 736MB in run 1) and the suites that render a feed still read 1 to 2GB: Feed and FeedSafety are
  // 333 and 296MB once collected. Their workers are recycled after the file, which is harmless. A
  // suite that HOLDS more than about 500MB after a collection is leaking: run
  // `node --expose-gc ../node_modules/.bin/jest <file> --logHeapUsage`, and look for a jest.fn on a
  // hot path before anything else.
  workerIdleMemoryLimit: '1GB',
  moduleNameMapper: {
    // Its "react-native" exports are untranspiled ESM (.mjs); the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
