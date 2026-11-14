/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
  // Tests that render the whole route tree (renderRouter) load every route on their first render,
  // which takes several seconds on a cold CI runner.
  testTimeout: 30_000,
  // The route-tree suites (Feed, AlsoBevd) leave a worker holding ~1.7 GB; one more suite on that
  // worker ran CI's out of heap (#204). Recycle a worker that ends a suite above this.
  workerIdleMemoryLimit: '1GB',
  moduleNameMapper: {
    // SPIKE S1: CSS modules (the Find Bev camera view) resolve to a class-name echo.
    '\\.module\\.css$': '<rootDir>/jest.cssModule.js',
    // Its "react-native" exports are untranspiled ESM (.mjs); the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
