// IA-2 against a real stack: `get_app_config()` is granted to `anon`, so the
// read has to work before anyone signs in. Skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY, like the other *.live files.
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

function memoryStorage(): AuthStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

const SEMVER = /^\d+\.\d+\.\d+$/;

describe.skipIf(!url || !publishableKey)('meta, against a live local stack', () => {
  // Shapes only: the row is an operator's to edit, so a stack with a raised
  // floor or a maintenance window open is still a passing one.
  it('reads the app config signed out', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    expect(await api.getSession()).toBeNull();

    const config = await api.meta.getAppConfig();
    expect(config.minAppVersion).toMatch(SEMVER);
    expect(config.minContractVersion).toMatch(SEMVER);
    expect(typeof config.maintenance).toBe('boolean');
    expect(config.maintenanceMessage === null || typeof config.maintenanceMessage === 'string').toBe(true);
    expect(Object.keys(config).sort()).toEqual(['maintenance', 'maintenanceMessage', 'minAppVersion', 'minContractVersion']);
  });
});
