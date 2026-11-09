// The Search tab map's Google config, from the two public env vars Expo inlines at build time
// (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, EXPO_PUBLIC_GOOGLE_MAP_ID; see app/.env.example). Pure, so it is
// unit-tested; `mapConfig` below reads the env vars literally so Expo can inline them.

/** Google's public demo Map ID: Advanced Markers work on it, but it has no Bevi styling. Localhost only. */
export const DEMO_MAP_ID = 'DEMO_MAP_ID';

export type MapConfig =
  | { ok: true; key: string; mapId: string; /** No Map ID was set, so `mapId` is `DEMO_MAP_ID`. */ demoMapId: boolean }
  | { ok: false; problem: string };

export function readMapConfig(key: string | undefined, mapId: string | undefined): MapConfig {
  const k = (key ?? '').trim();
  if (!k) return { ok: false, problem: 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set.' };
  const id = (mapId ?? '').trim();
  return { ok: true, key: k, mapId: id || DEMO_MAP_ID, demoMapId: !id };
}

/** Read literally so Expo inlines the values at build time. */
export const mapConfig: MapConfig = readMapConfig(
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  process.env.EXPO_PUBLIC_GOOGLE_MAP_ID,
);
