// SPIKE S1: jest-expo has no mapping for CSS modules. Every class reads back as its own name, so a
// test can assert `className` without a CSS build.
module.exports = new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : String(key)) });
