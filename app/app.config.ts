import type { ExpoConfig } from 'expo/config';

// Bevi is web-only (decided 2026-10-11): an Expo web build served by Vercel and added to the iPhone
// home screen. No native builds, so no ios/android blocks, bundle ids or EAS profiles.
const config: ExpoConfig = {
  name: 'Bevi',
  slug: 'bevi',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // Single-page web build served by Vercel (vercel.json, root directory `app`). The HTML shell,
  // manifest and home-screen icons live in public/.
  web: { bundler: 'metro', output: 'single', favicon: './public/icon-192.png' },
  plugins: ['expo-router', 'expo-image'],
  experiments: { typedRoutes: true },
};

export default config;
