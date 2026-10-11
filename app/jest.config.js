/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Its "react-native" exports are untranspiled ESM (.mjs); the CommonJS build is the same icons.
    '^lucide-react-native$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^lucide-react-native/icons/(.*)$': '<rootDir>/../node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
