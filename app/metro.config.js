// Expo's default Metro config, with one change: the production minifier is metro.minify.js, which
// is Metro's own terser minifier except that it keeps component names in app/src. The internal bug
// reporter reads them at run time (src/features/bug-report/pick.ts); metro.minify.js says why and
// what it costs. Nothing else differs from `expo/metro-config`.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.minifierPath = require.resolve('./metro.minify.js');

module.exports = config;
