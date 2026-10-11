import type { ExpoConfig } from 'expo/config';

// APP_VARIANT=development (set by the eas.json `development` profile) installs a separate
// "Bevi Dev" app next to the real one. Both bundle ids (and schemes bevi / bevi-dev) need registering
// with the Google OAuth clients and Supabase Auth (Arjun's config, DEVELOPMENT-ARJUN 0.11) before task 1.4.
const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'Bevi Dev' : 'Bevi',
  slug: 'bevi',
  scheme: IS_DEV ? 'bevi-dev' : 'bevi',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: IS_DEV ? 'com.bevi.app.dev' : 'com.bevi.app',
    supportsTablet: false,
  },
  android: {
    package: IS_DEV ? 'com.bevi.app.dev' : 'com.bevi.app',
    // `primary` (light) from app/src/theme/tokens.ts; the icon art is full-bleed grape.
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#4a2a84' },
  },
  // Single-page web build served by Vercel (vercel.json, root directory `app`). The HTML shell,
  // manifest and home-screen icons live in public/.
  web: { bundler: 'metro', output: 'single', favicon: './public/icon-192.png' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/icon.png', imageWidth: 120, backgroundColor: '#4a2a84' }],
    'expo-image',
    'expo-secure-store',
  ],
  experiments: { typedRoutes: true },
};

export default config;
