// Expo's default Metro config, with two changes. Nothing else differs from `expo/metro-config`.
//
// 1. The production minifier is metro.minify.js, which is Metro's own terser minifier except that
//    it keeps component names in app/src. The internal bug reporter reads them at run time
//    (src/features/bug-report/pick.ts); metro.minify.js says why and what it costs.
//
// 2. A native bundle starts with Sentry's debug-ID snippet (crash reporting, IS-4,
//    src/lib/crashReporting.ts). Expo already gives every exported bundle a debug ID and writes it
//    into the bundle's source map; the snippet is what lets the SDK read that ID at run time and
//    put it on a report, so Sentry can match an error to the source map of the bundle that actually
//    ran. Without it reports are matched by release and build number, which an over-the-air update
//    shares with the binary it replaces the JavaScript of, so an update's errors would be read
//    against the wrong map. It is 282 bytes, and it is inert without the SDK.
//
//    Native only, on purpose. The web build has no crash reporting, and Sentry's own Expo config
//    (`getSentryExpoConfig`) is not used because it writes this snippet and a release constant
//    into every chunk of the web build too. With `nativeOnly` the web export is byte for byte what
//    it is without this plugin; keep it that way (`diff -rq` two exports) if this file changes.
const { getDefaultConfig } = require('expo/metro-config');
const { unstableBeforeAssetSerializationDebugIdPlugin } = require('@sentry/react-native/metro');

/** A serializer plugin that leaves a web bundle's modules exactly as they were handed to it. */
const nativeOnly = (plugin) => (args) => (args.graph.transformOptions.platform === 'web' ? args.premodules : plugin(args));

const config = getDefaultConfig(__dirname, {
  unstable_beforeAssetSerializationPlugins: [nativeOnly(unstableBeforeAssetSerializationDebugIdPlugin)],
});

config.transformer.minifierPath = require.resolve('./metro.minify.js');

module.exports = config;
