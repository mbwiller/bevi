import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { DRAFT_KEY, loadDraft, UNPLACED_KEY } from '../draft';
import { defaultStorage, loadStorage, nativeStorage, resetNativeStorage, useStorageReady } from '../draftStorage';

// The iOS file (jest resolves '../draftStorage' as iOS): AsyncStorage read into memory once, then
// written through. The web file is `localStorage` and has nothing to wait for.

const storedDraft = (text: string) =>
  JSON.stringify({ text, marks: [], owner: 'tester', idempotencyKey: '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11', savedAt: new Date().toISOString() });

beforeEach(async () => {
  await AsyncStorage.clear();
  resetNativeStorage();
});

describe('the reporter storage on iOS', () => {
  it('is the in-memory view of AsyncStorage, and the app\'s default', () => {
    expect(defaultStorage()).toBe(nativeStorage);
  });

  it('reads nothing until it is loaded, then a note that AsyncStorage kept', async () => {
    await AsyncStorage.setItem(DRAFT_KEY, storedDraft('the rank screen flickers'));
    expect(nativeStorage.getItem(DRAFT_KEY)).toBeNull();
    await loadStorage();
    expect(loadDraft(nativeStorage)?.text).toBe('the rank screen flickers');
  });

  it('writes through to AsyncStorage, in order, and removes through to it', async () => {
    await loadStorage();
    nativeStorage.setItem(DRAFT_KEY, storedDraft('first'));
    nativeStorage.setItem(DRAFT_KEY, storedDraft('second'));
    nativeStorage.setItem(UNPLACED_KEY, JSON.stringify({ ids: ['T-1'], owner: 'tester' }));
    expect(nativeStorage.getItem(DRAFT_KEY)).toContain('second');
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY))!).text).toBe('second'));
    await waitFor(async () => expect(await AsyncStorage.getItem(UNPLACED_KEY)).not.toBeNull());

    nativeStorage.removeItem(DRAFT_KEY);
    expect(nativeStorage.getItem(DRAFT_KEY)).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it('a slow first read never brings back what was forgotten meanwhile', async () => {
    await AsyncStorage.setItem(DRAFT_KEY, storedDraft('old note'));
    const loading = loadStorage();
    nativeStorage.removeItem(DRAFT_KEY);
    await loading;
    expect(nativeStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('storage that fails reads as no note, and a failing write is dropped without throwing', async () => {
    const multiGet = jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('disk'));
    await expect(loadStorage()).resolves.toBeUndefined();
    expect(nativeStorage.getItem(DRAFT_KEY)).toBeNull();
    multiGet.mockRestore();

    const setItem = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('full'));
    expect(() => nativeStorage.setItem(DRAFT_KEY, storedDraft('kept in memory'))).not.toThrow();
    expect(nativeStorage.getItem(DRAFT_KEY)).toContain('kept in memory');
    setItem.mockRestore();
  });

  it('the host waits for it: not ready until the stored note has been read', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const multiGet = jest.spyOn(AsyncStorage, 'multiGet').mockImplementation(async () => {
      await gate;
      return [
        [DRAFT_KEY, storedDraft('restored')],
        [UNPLACED_KEY, null],
      ];
    });
    const hook = await renderHook(() => useStorageReady());
    expect(hook.result.current).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(hook.result.current).toBe(true));
    expect(loadDraft(nativeStorage)?.text).toBe('restored');
    multiGet.mockRestore();
  });
});
