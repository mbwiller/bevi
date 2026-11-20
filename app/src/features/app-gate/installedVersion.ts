import * as Application from 'expo-application';

/**
 * The version and build of the installed binary (the native file; installedVersion.web.ts reports
 * none). From `expo-application`, which reads the app's Info.plist, never from the JS manifest
 * (`Constants.expoConfig.version`): after an over-the-air update the manifest describes the new
 * bundle while the binary is still the old one, and the binary is what the gate is about.
 */
export function installedVersion(): string | null {
  return Application.nativeApplicationVersion ?? null;
}

/** The build number (CFBundleVersion), for the support line on the update screen. */
export function installedBuild(): string | null {
  return Application.nativeBuildVersion ?? null;
}
