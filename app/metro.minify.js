// The production minifier (metro.config.js points `transformer.minifierPath` here): Metro's own
// terser minifier, except that in the app's own source (app/src) it keeps the names of functions
// and classes that start with a capital letter, which is to say components.
//
// Why: the internal bug reporter (src/features/bug-report/pick.ts) names the component under the
// reporter's finger by reading `type.name` off its React fiber, and looks that name up in
// componentFiles.generated.ts to put the source file in the ticket. Terser's default mangling turns
// `function TabBar` into `function t`, so in a production build every name would be gone.
//
// Why only app/src: the libraries have components with the app's names (React Navigation has a
// `Screen`, a `Header`, a `Button`), and they sit in the same fiber chain. Kept, they would be
// taken for the app's; mangled, as they always were, they cannot be. It is also cheaper.
//
// How: Metro calls the minifier once per module with `filename` relative to the project root
// (`src/components/TabBar.tsx`, `../node_modules/…`, `../shared/src/…`; `isAppSource` below also
// takes an absolute path, should a later Metro pass one) and `config`, the
// `transformer.minifierConfig`, which metro-minify-terser hands to terser.minify. Terser's
// top-level `keep_fnames` / `keep_classnames` apply to both its compressor and its mangler and take
// a RegExp. They cover function declarations and named function expressions, which is how every
// component in src/ is written (`function Name`, `memo(function Name`); an arrow function assigned
// to a const would still lose its name, so do not write a component that way.
//
// Cost, measured on the entry bundle (2026-11-13): 3.7 KB raw and 0.9 KB gzipped, 0.11% of each.
// For comparison, keeping capitalised names in every module adds 0.8% raw and 0.6% gzipped, and
// `keep_fnames: true` for every module adds 8.5% raw and 4.5% gzipped.

const path = require('path');

const COMPONENT_NAME = /^[A-Z]/;

/**
 * Whether a module is the app's own source. Metro passes `src/…` today; an absolute path, or one
 * relative to the repo root, would carry the segment `/app/src/` instead. Never a dependency.
 */
function isAppSource(filename) {
  const name = String(filename ?? '').replace(/\\/g, '/');
  if (/(^|\/)node_modules\//.test(name)) return false;
  return /^(\.\/)?src\//.test(name) || /(^|\/)app\/src\//.test(name);
}

/** metro-minify-terser is Metro's dependency, not the app's: `expo` brings `@expo/metro`, which re-exports it. */
function loadTerserMinifier() {
  let minifier;
  try {
    const expoDir = path.dirname(require.resolve('expo/package.json'));
    minifier = require(require.resolve('@expo/metro/metro-minify-terser', { paths: [expoDir] }));
  } catch {
    minifier = require('metro-minify-terser');
  }
  return minifier.default ?? minifier;
}

const terserMinifier = loadTerserMinifier();

module.exports = function minify(options) {
  if (!isAppSource(options.filename)) return terserMinifier(options);
  return terserMinifier({
    ...options,
    config: { ...options.config, keep_fnames: COMPONENT_NAME, keep_classnames: COMPONENT_NAME },
  });
};

// So the rule can be checked from node (`require('./metro.minify.js').isAppSource(path)`); Metro only calls the function.
module.exports.isAppSource = isAppSource;
