import type { ExpoConfig } from 'expo/config';

// Bevi is an iOS app and, for now, still the web build served by Vercel (DEVELOPMENT-MATT-IOS.md;
// the web-only decision of 2026-10-11 was reversed on 2026-11-17). The native project is never
// committed: `expo prebuild` generates ios/ from this file, locally or on EAS (eas.json).
//
// One owner at a time for this file and eas.json. Values that come from an account (bundle id,
// Expo owner, EAS project id) are Arjun's to hand over; nothing here is a secret.

// Shown word for word in iOS's permission dialogs, and read by App Review: say what and why.
const CAMERA_PERMISSION = "Bevi uses the camera to photograph a drink you're adding and to scan a barcode.";
const PHOTOS_PERMISSION = "Bevi uses your photo library so you can choose a photo for a drink you're adding.";

// `surface` from src/theme/tokens.ts, light then dark: the launch screen hands over to the in-app
// Splash (features/auth/Splash.tsx), which draws the same wordmark on the same colour.
const SURFACE_LIGHT = '#ffffff';
const SURFACE_DARK = '#121214';
// The in-app Splash draws the wordmark 56pt high; at its 1908:867 shape that is 123pt wide.
const SPLASH_WORDMARK_WIDTH = 123;

const config: ExpoConfig = {
  name: 'Bevi',
  slug: 'bevi',
  // The Expo organisation that owns the EAS project (@bevi/bevi). With `extra.eas.projectId` below
  // it is what every `eas` command reads to find the project; neither is a secret. They are written
  // by hand because `eas project:init` cannot edit a config that is code.
  owner: 'bevi',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // bevi:// links, and the scheme the development build opens with.
  scheme: 'bevi',
  // 1024x1024, square corners, no alpha (design/brand/app-icon-1024.png): iOS rounds it itself.
  icon: './assets/icon.png',
  ios: {
    // Registered 2026-11-17 as an explicit App ID (team prefix 9NA45GL4CJ). Never changes: signing,
    // universal links and the App Store record are tied to it.
    bundleIdentifier: 'app.bevi.ios',
    // Used by a local build only. EAS numbers its own builds (eas.json: appVersionSource "remote").
    buildNumber: '1',
    // iPhone only. An iPad runs it in iPhone compatibility mode.
    supportsTablet: false,
    // Expo SDK 57's own floor, stated so that it is a decision: it is the oldest iOS a friend can
    // install on, and `minAppVersion` may never be raised above a version this target can run.
    deploymentTarget: '16.4',
    // Only standard HTTPS: without this every upload stalls on the export-compliance question.
    config: { usesNonExemptEncryption: false },
    // Required-reason APIs the app's own code and its libraries touch (PrivacyInfo.xcprivacy).
    // Without a declaration App Store Connect answers an upload with ITMS-91053.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        // The session and small preferences, kept in the app's own defaults.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        // Files inside the app's own container (picked photos, the image cache).
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        // Checking there is room before writing to disk.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        // React Native's timers measure elapsed time from the boot clock.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
      ],
    },
  },
  // Single-page web build served by Vercel (vercel.json, root directory `app`). The HTML shell,
  // manifest and home-screen icons live in public/.
  web: { bundler: 'metro', output: 'single', favicon: './public/icon-192.png' },
  plugins: [
    // No /_sitemap: it would list every route to anyone, signed in or not.
    ['expo-router', { sitemap: false }],
    'expo-image',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-wordmark.png',
        imageWidth: SPLASH_WORDMARK_WIDTH,
        backgroundColor: SURFACE_LIGHT,
        dark: { image: './assets/splash-wordmark-dark.png', backgroundColor: SURFACE_DARK },
      },
    ],
    // No microphone string: the app takes photos, never video.
    ['expo-image-picker', { cameraPermission: CAMERA_PERMISSION, photosPermission: PHOTOS_PERMISSION, microphonePermission: false }],
    // The iOS 27 SDK (Xcode 27) only launches apps on the UIKit scene life cycle, which SDK 57 adopts
    // only when asked. Harmless on EAS's Xcode 26 image, required on a Mac with Xcode 27. SDK 58
    // does this by default: drop the option in the upgrade PR.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: '3797aad9-3485-4856-8e46-b6656a7716f1' } },
};

export default config;
