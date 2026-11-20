// Which files decide expo-updates' runtime version (`runtimeVersion: { policy: 'fingerprint' }` in
// app.config.ts). The fingerprint hashes everything that can change the native project, and an
// over-the-air update only reaches installed binaries whose fingerprint matches. So an input that
// cannot change the native project must not be in it: otherwise an unrelated lockfile refresh or a
// tweak to eas.json changes the hash and `eas update` then reaches no installed binary.
//
// Excluded here, each because it cannot change what is compiled into the binary:
//   - the browser-data packages: they are read while app.config.ts is transpiled (babel pulls in
//     browserslist and its data), and `npm ci` against a refreshed lockfile bumps them;
//   - eas.json: build profiles, channels and the build image, not the native project;
//   - .gitignore and the package.json `scripts` section.
// Everything else stays in: the dependencies' native code, app.config.ts and its plugins, the assets
// the plugins use, patches. Do not add an entry here without checking it cannot reach the native
// project (DEVELOPMENT-MATT-IOS.md, "How a change reaches a phone now").

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  ignorePaths: [
    // `{,../}`: the packages sit one level up (`../node_modules`) in this monorepo, but at
    // `node_modules` in a checkout without hoisting.
    '{,../}node_modules/caniuse-lite/**',
    '{,../}node_modules/browserslist/**',
    '{,../}node_modules/electron-to-chromium/**',
    '{,../}node_modules/baseline-browser-mapping/**',
    '{,../}node_modules/node-releases/**',
    'eas.json',
  ],
  // Replaces the default (package.json android/ios scripts without "run"), which PackageJsonScriptsAll covers.
  sourceSkips: ['PackageJsonScriptsAll', 'GitIgnore'],
};
