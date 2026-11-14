/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
  // Tests that render the whole route tree (renderRouter) load every route on their first render,
  // which takes several seconds on a cold CI runner.
  testTimeout: 30_000,
  // CI kept dying with "FATAL ERROR: Reached heap limit - JavaScript heap out of memory" (exit 134),
  // not on any one test: a worker runs suite after suite, each mounting the route tree through
  // jest-expo and react-native-web, and its heap creeps until it passes Node's default ceiling
  // (~2GB; the crash reported 2083MB). It was never a clean failure -- run 43537391961 on main is the
  // same commit four times over, and went failure, failure, success, failure, so green runs were
  // retries rather than passes.
  //
  // This recycles a worker once its heap passes the limit, which bounds the creep instead of raising
  // the ceiling: a real leak then still fails rather than taking longer to die. The cost is the
  // occasional worker restart.
  workerIdleMemoryLimit: '512MB',
  moduleNameMapper: {
    // SPIKE S1: CSS modules (the Find Bev camera view) resolve to a class-name echo.
    '\\.module\\.css$': '<rootDir>/jest.cssModule.js',
    // Its "react-native" exports are untranspiled ESM (.mjs); the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
