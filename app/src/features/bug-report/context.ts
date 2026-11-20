import { CONTRACT_VERSION, type BugReportEnvironment } from '@bevi/shared';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Dimensions, PixelRatio, Platform } from 'react-native';

import { connectionOnline } from '@/lib/connectionStore';

import { buildOf, routeOf, safeAreaOf, safePathOf, stageOf, type ContextSources } from './contextCommon';

export * from './contextCommon';

/**
 * The context the reporter sends without typing it, on iOS (docs/bug-workflow.md; context.web.ts is
 * the web file). The same rules: internal reporters only, an ALLOW-LIST of the keys of
 * `BugReportEnvironment` and nothing more, which the server enforces again.
 *
 * What an iPhone build can say, in the contract's own fields (the contract has none for a device
 * model, an update or a runtime, and the server drops any key it does not name):
 *   * `route` and `path`: the Expo Router pattern ('/bev/[id]') and the concrete path. Never the
 *     query string, and no path with a percent-encoded or long opaque segment (`safePathOf`): the
 *     photo viewer's route carries an encoded image address.
 *   * `platform`: 'ios · iPhone 15 Pro', the device model; `osVersion`: 'iOS 18.2'.
 *   * `appVersion`: the installed binary's version and build number, '0.1.0 (3)'.
 *   * `build`: what is running on top of that binary, as one line: the short git SHA when
 *     `EXPO_PUBLIC_BUILD_SHA` was set, the OTA update id (first eight characters) and the runtime
 *     version when `expo-updates` has them (it has neither in development), and the contract
 *     version the app was built against.
 *   * `stage`, `theme`, `online`, `viewport`, `pixelRatio`, `safeArea`, `occurredAt`.
 * Never collected: a token, a header, a storage dump, the device name (it is usually the owner's
 * name), or any identifier of the device or the person.
 */

/** Reads one thing defensively: a missing native module or an empty value is "nothing", never a throw. */
function read<T>(get: () => T | null | undefined): T | undefined {
  try {
    return get() ?? undefined;
  } catch {
    return undefined;
  }
}

/** The device model: the human-readable name when expo-constants has one, else Apple's identifier. */
export function deviceModel(): string | undefined {
  const ios = read(() => (Constants.platform as { ios?: { model?: string | null; platform?: string } } | undefined)?.ios);
  const model = ios?.model?.trim() || ios?.platform?.trim();
  return model || undefined;
}

/** 'ios · iPhone 15 Pro', or 'ios' when the model is not known. */
export function platformLine(model: string | undefined): string {
  return model ? `${Platform.OS} · ${model}` : Platform.OS;
}

/** 'iOS 18.2', or nothing when the system does not say. */
export function osVersionLine(version: unknown): string | undefined {
  if (typeof version === 'string' && version) return `iOS ${version}`;
  if (typeof version === 'number') return `iOS ${version}`;
  return undefined;
}

/** '0.1.0 (3)', '0.1.0' without a build number, undefined with neither. */
export function appVersionLine(version: string | undefined, build: string | undefined): string | undefined {
  if (!version) return undefined;
  return build ? `${version} (${build})` : version;
}

/** The one line the `build` field carries on iOS: SHA, update, runtime, contract, whichever exist. */
export function buildLine(parts: { sha?: string; updateId?: string; runtimeVersion?: string; contract?: string }): string | undefined {
  const out = [
    parts.sha,
    parts.updateId ? `update ${parts.updateId.slice(0, 8)}` : undefined,
    parts.runtimeVersion ? `runtime ${parts.runtimeVersion}` : undefined,
    parts.contract ? `contract ${parts.contract}` : undefined,
  ].filter((part): part is string => !!part);
  return out.length ? out.join(' · ') : undefined;
}

function windowSize(): { width: number; height: number } | undefined {
  const { width, height } = Dimensions.get('window');
  if (!width || !height) return undefined;
  return { width: Math.round(width), height: Math.round(height) };
}

/** Builds the environment block. Every field is best effort; nothing is invented. */
export function collectContext(sources: ContextSources = {}): BugReportEnvironment {
  const size = sources.window ?? read(windowSize);
  const version = read(() => Application.nativeApplicationVersion) ?? read(() => Constants.expoConfig?.version);
  const build = read(() => Application.nativeBuildVersion);
  const scale = read(() => PixelRatio.get());

  const environment: BugReportEnvironment = {
    route: routeOf(sources.routePattern) ?? safePathOf(sources.pathname),
    path: safePathOf(sources.pathname),
    platform: platformLine(deviceModel()),
    osVersion: Platform.OS === 'ios' ? osVersionLine(Platform.Version) : undefined,
    appVersion: appVersionLine(version, build),
    // Read literally so Expo inlines it; an EAS build sets it from the commit when it is given one.
    build: buildLine({
      sha: buildOf(process.env.EXPO_PUBLIC_BUILD_SHA),
      updateId: read(() => Updates.updateId),
      runtimeVersion: read(() => Updates.runtimeVersion),
      contract: CONTRACT_VERSION,
    }),
    stage: stageOf(process.env.NODE_ENV),
    theme: sources.theme === 'light' || sources.theme === 'dark' ? sources.theme : undefined,
    online: read(() => connectionOnline()),
    viewport: size ? `${size.width}x${size.height}` : undefined,
    pixelRatio: typeof scale === 'number' && scale > 0 ? Math.round(scale * 100) / 100 : undefined,
    safeArea: safeAreaOf(sources.insets),
    occurredAt: (sources.now ?? new Date()).toISOString(),
    reproducibility: 'unknown',
  };

  // Drop the keys nothing could fill, so the preview shows only real values. `false` is a value.
  for (const key of Object.keys(environment) as (keyof BugReportEnvironment)[]) {
    if (environment[key] === undefined || environment[key] === '') delete environment[key];
  }
  return environment;
}
