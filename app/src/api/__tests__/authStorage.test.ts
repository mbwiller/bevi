// The native session adapter (authStorage.ts; jest resolves modules as iOS). The Keychain and
// AsyncStorage are replaced by in-memory maps whose calls can be made to fail.

import { INDEX_KEY, INSTALL_MARKER, KEY_PREFIX, createAuthStorage, secureKeyFor } from '../authStorage';

const mockKeychain = new Map<string, string>();
const mockDisk = new Map<string, string>();
const mockFail = { keychain: false, markerRead: false, markerWrite: false };
const mockKeychainOptions: unknown[] = [];
const VALID_KEY = /^[\w.-]+$/;

// Mirrors expo-secure-store ~57.0.4: key validation, no size limit on a value. If a later version
// adds a limit, add it here too and the 6 KB round trip below will show it.
jest.mock('expo-secure-store', () => {
  const guard = (key: string, options: unknown) => {
    mockKeychainOptions.push(options);
    if (!VALID_KEY.test(key)) throw new Error(`Invalid key provided to SecureStore: ${key}`);
    if (mockFail.keychain) throw new Error('errSecInteractionNotAllowed');
  };
  return {
    AFTER_FIRST_UNLOCK: 7,
    getItemAsync: jest.fn(async (key: string, options: unknown) => {
      guard(key, options);
      return mockKeychain.get(key) ?? null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string, options: unknown) => {
      guard(key, options);
      mockKeychain.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string, options: unknown) => {
      guard(key, options);
      mockKeychain.delete(key);
    }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      if (mockFail.markerRead) throw new Error('AsyncStorage unavailable');
      return mockDisk.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockFail.markerWrite) throw new Error('AsyncStorage unavailable');
      mockDisk.set(key, value);
    }),
  },
}));

const KEY = 'sb-abcdefghijklmnop-auth-token';
const ITEM = `${KEY_PREFIX}${KEY}`;
/** A session-shaped value of about 6 KB, with some multi-byte characters. */
const BIG = JSON.stringify({ access_token: 'x'.repeat(3000), refresh_token: 'r'.repeat(40), user: { name: 'Zoë ☕ '.repeat(350) } });

/** Every Keychain item this adapter owns. */
const ownItems = () => [...mockKeychain.keys()].filter((k) => k.startsWith(KEY_PREFIX) || k === INDEX_KEY);

/** An adapter on a phone that has already run this install once (the marker is set). */
function launch() {
  mockDisk.set(INSTALL_MARKER, '1');
  return createAuthStorage();
}

beforeEach(() => {
  mockKeychain.clear();
  mockDisk.clear();
  mockKeychainOptions.length = 0;
  Object.assign(mockFail, { keychain: false, markerRead: false, markerWrite: false });
});

describe('createAuthStorage (native)', () => {
  it('round-trips a 6 KB value as one Keychain item, across launches', async () => {
    expect(new TextEncoder().encode(BIG).length).toBeGreaterThan(6000);
    await launch().setItem(KEY, BIG);
    expect(mockKeychain.get(ITEM)).toBe(BIG);
    expect(ownItems().sort()).toEqual([INDEX_KEY, ITEM].sort());
    expect(await launch().getItem(KEY)).toBe(BIG);
  });

  it('stores with AFTER_FIRST_UNLOCK', async () => {
    await launch().setItem(KEY, 'v');
    expect(mockKeychainOptions.length).toBeGreaterThan(0);
    for (const o of mockKeychainOptions) expect(o).toEqual({ keychainAccessible: 7 });
  });

  it('replaces a value in place', async () => {
    const s = launch();
    await s.setItem(KEY, BIG);
    await s.setItem(KEY, 'short');
    expect(mockKeychain.get(ITEM)).toBe('short');
    expect(await launch().getItem(KEY)).toBe('short');
  });

  it('removeItem deletes the stored value', async () => {
    const s = launch();
    await s.setItem(KEY, BIG);
    await s.removeItem(KEY);
    expect(await s.getItem(KEY)).toBeNull();
    expect(mockKeychain.has(ITEM)).toBe(false);
    expect(await launch().getItem(KEY)).toBeNull();
  });

  it('round-trips within the launch and never rejects when every Keychain call throws', async () => {
    mockFail.keychain = true;
    const s = launch();
    await expect(s.getItem(KEY)).resolves.toBeNull();
    await expect(s.setItem(KEY, BIG)).resolves.toBeUndefined();
    await expect(s.getItem(KEY)).resolves.toBe(BIG);
    await expect(s.removeItem(KEY)).resolves.toBeUndefined();
    await expect(s.getItem(KEY)).resolves.toBeNull();
  });

  it('does not bring back a removed session when the Keychain delete fails', async () => {
    const s = launch();
    await s.setItem(KEY, 'v');
    mockFail.keychain = true;
    await s.removeItem(KEY);
    expect(await s.getItem(KEY)).toBeNull();
  });

  describe('reinstall rule', () => {
    async function storedFromAnEarlierInstall() {
      await launch().setItem(KEY, BIG);
    }

    it('marker present: the stored session is kept', async () => {
      await storedFromAnEarlierInstall();
      expect(await launch().getItem(KEY)).toBe(BIG);
    });

    it('marker absent: the old session is cleared, then the marker is set', async () => {
      await storedFromAnEarlierInstall();
      mockDisk.clear(); // the app was deleted: AsyncStorage goes, the Keychain stays
      const s = createAuthStorage();
      expect(await s.getItem(KEY)).toBeNull();
      expect(mockDisk.get(INSTALL_MARKER)).toBe('1');
      expect(ownItems()).toEqual([]);
      // Signing in again after the wipe persists as usual.
      await s.setItem(KEY, 'new account');
      expect(await createAuthStorage().getItem(KEY)).toBe('new account');
    });

    it('marker absent: a write racing the first read still waits for the wipe', async () => {
      await storedFromAnEarlierInstall();
      mockDisk.clear();
      const s = createAuthStorage();
      await Promise.all([s.setItem(KEY, 'new account'), s.getItem(KEY)]);
      expect(await launch().getItem(KEY)).toBe('new account');
    });

    it('marker read fails: nothing is deleted and the session is kept', async () => {
      await storedFromAnEarlierInstall();
      mockDisk.clear();
      mockFail.markerRead = true;
      expect(await createAuthStorage().getItem(KEY)).toBe(BIG);
      expect(mockDisk.has(INSTALL_MARKER)).toBe(false);
      expect(mockKeychain.get(ITEM)).toBe(BIG);
    });

    it('marker absent and the wipe fails: the old session is not served, and the marker stays unset', async () => {
      await storedFromAnEarlierInstall();
      mockDisk.clear();
      mockFail.keychain = true;
      const s = createAuthStorage();
      expect(await s.getItem(KEY)).toBeNull();
      expect(mockDisk.has(INSTALL_MARKER)).toBe(false);
      mockFail.keychain = false;
      expect(await s.getItem(KEY)).toBeNull();
    });
  });
});

describe('secureKeyFor', () => {
  it("leaves supabase-js's key as it is", () => {
    expect(secureKeyFor(KEY)).toBe(KEY);
  });

  it('maps characters SecureStore rejects, one-to-one, to a valid key', () => {
    const odd = ['sb:x/auth token', 'a.b', 'a_b', 'a_002eb', 'é'];
    const mapped = odd.map(secureKeyFor);
    for (const m of mapped) expect(m).toMatch(VALID_KEY);
    expect(mapped).not.toContain('a.b');
    expect(new Set(mapped).size).toBe(odd.length);
  });

  it('stores and reads back a key that needed mapping', async () => {
    await launch().setItem('sb:odd key', 'v');
    expect(await launch().getItem('sb:odd key')).toBe('v');
  });
});
